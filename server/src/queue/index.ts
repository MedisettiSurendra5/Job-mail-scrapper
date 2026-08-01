import type { BrowserContext } from "playwright";
import { prisma } from "../db";
import { decrypt } from "../crypto";
import {
  addExternalJob,
  getJobrightContext,
  pullContactsForJob,
  runSearch,
  saveJobrightSession,
} from "../automation/jobright";
import { fetchTopSoftwareEngineerJobs } from "../automation/githubH1b";
import { sendOutreachEmail } from "../automation/mailer";
import { GoogleRefreshTokenRevokedError, refreshAccessToken } from "../automation/googleOAuth";
import { classifyEmail, fetchApplicationEmails } from "../automation/emailTracker";
import { resumePathFor } from "../paths";
import { sanitizeErrorMessage } from "../sanitize";
import { SearchFilters } from "../types";
import { TaskQueue } from "./taskQueue";

// Owns the single shared JobRight login - concurrency 1 is load-bearing.
export const jobrightQueue = new TaskQueue(1);
// Pure SMTP sends, no browser involved - a little parallelism is fine.
export const emailQueue = new TaskQueue(2);
// Per-user Gmail API reads - no shared login/browser constraint, so this is
// entirely independent of the queue above.
export const trackerQueue = new TaskQueue(2);

const EMAIL_MIN_DELAY_MS = 8000;
const EMAIL_MAX_DELAY_MS = 20000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function storeContacts(jobId: number, pulled: Awaited<ReturnType<typeof pullContactsForJob>>) {
  const created = [];
  for (const c of pulled.contacts) {
    created.push(
      await prisma.contact.create({
        data: {
          jobId,
          name: c.name,
          title: c.title,
          email: c.email || null,
          linkedinUrl: c.linkedinUrl || null,
          subject: c.subject,
          body: c.body,
          status: c.status,
        },
      })
    );
  }
  return created;
}

// Shared by add_job (URL/View-Job path) and run_search (search-discovered
// jobs): given a job that already has a jobRightId, pull its Insider
// Connection contacts and store them. Used so both discovery paths land in
// exactly the same state.
async function pullAndStoreContacts(
  context: Awaited<ReturnType<typeof getJobrightContext>>,
  job: { id: number; jobRightId: string; url: string; title?: string | null; company?: string | null }
) {
  const pulled = await pullContactsForJob(context, job.jobRightId);
  // For a member-pasted URL, that IS the real original posting - trust it
  // over the job board's own applyLink/originalUrl, which can come back as
  // a broken placeholder for externally-added jobs (seen live: a LinkedIn
  // add returning "https://www.linkedin.com/jobs/view/1"). Only fall back to
  // the job board's data for search-discovered jobs, where job.url is just
  // the synthetic info-page link and there's no better source.
  const isSyntheticUrl = /^https?:\/\/jobright\.ai\//i.test(job.url);
  const applyUrl = isSyntheticUrl ? pulled.applyUrl || null : job.url;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      title: pulled.title || job.title,
      company: pulled.company || job.company,
      applyUrl,
      location: pulled.location || null,
      employmentType: pulled.employmentType || null,
      workModel: pulled.workModel || null,
      seniority: pulled.seniority || null,
      datePosted: pulled.datePosted,
      status: "ready",
    },
  });
  return storeContacts(job.id, pulled);
}

// Add-by-URL and pulling Insider Connection emails are one continuous
// pipeline from the user's point of view (paste URL -> click Add Job -> the
// job shows up with its contacts already pulled), so both steps run back to
// back in the same browser session rather than requiring a second click.
jobrightQueue.register("add_job", async (payload: { jobId: number; url: string }) => {
  // getJobrightContext() must stay INSIDE the try: it is where a failed
  // JobRight login throws, and a throw outside would skip the catch below,
  // leaving the Job row stuck at "pending" with a null errorMessage - a
  // silent hang with no explanation anywhere in the UI.
  let context: BrowserContext | null = null;
  try {
    context = await getJobrightContext();
    const result = await addExternalJob(context, payload.url);
    await prisma.job.update({
      where: { id: payload.jobId },
      data: { jobRightId: result.jobId, title: result.title, company: result.company },
    });
    await pullAndStoreContacts(context, { id: payload.jobId, jobRightId: result.jobId, url: payload.url, ...result });
    await saveJobrightSession(context);
  } catch (e: any) {
    try {
      await prisma.job.update({
        where: { id: payload.jobId },
        data: { status: "error", errorMessage: sanitizeErrorMessage(String(e?.message || e)) },
      });
    } catch (updateErr: any) {
      // The job can be deleted (user clicked Remove) while this was still
      // running - nothing left to record the error on, which is fine.
      if (updateErr?.code !== "P2025") throw updateErr;
    }
    throw e;
  } finally {
    await context?.close();
  }
});

// Kept for manually retrying/refreshing a job whose initial pull failed or
// came back empty - not part of the normal add-job path above.
jobrightQueue.register("pull_emails", async (payload: { jobId: number }) => {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: payload.jobId } });
  const jobRightId = job.jobRightId;
  if (!jobRightId) throw new Error("This job hasn't finished being added yet");

  const existingCount = await prisma.contact.count({ where: { jobId: job.id } });
  if (existingCount > 0) return;

  let context: BrowserContext | null = null;
  try {
    context = await getJobrightContext();
    await pullAndStoreContacts(context, { ...job, jobRightId });
    await saveJobrightSession(context);
  } finally {
    await context?.close();
  }
});

jobrightQueue.register(
  "run_search",
  async (payload: {
    filters: SearchFilters;
    maxPerRun: number;
    requestedBy: number;
    autoSend: boolean;
    sendAsUserId?: number;
    ruleId?: number;
  }) => {
    let context: BrowserContext | null = null;
    try {
      context = await getJobrightContext();
      const jobIds = await runSearch(context, payload.filters, payload.maxPerRun);

      for (const jobRightId of jobIds) {
        const existing = await prisma.job.findFirst({ where: { jobRightId } });
        if (existing) continue; // already known - search results don't change once pulled

        const job = await prisma.job.create({
          data: {
            url: `https://jobright.ai/jobs/info/${jobRightId}`,
            jobRightId,
            status: "pending",
            addedById: payload.requestedBy,
            source: "search",
          },
        });

        try {
          const contacts = await pullAndStoreContacts(context, { id: job.id, jobRightId, url: job.url });

          if (payload.autoSend && payload.sendAsUserId) {
            for (const c of contacts) {
              if (c.status === "found" && c.email) {
                await emailQueue.enqueue(
                  "send_email",
                  { contactId: c.id, userId: payload.sendAsUserId },
                  payload.requestedBy
                );
              }
            }
          }
        } catch (e: any) {
          // One bad job in a batch shouldn't sink the whole search run.
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "error", errorMessage: sanitizeErrorMessage(String(e?.message || e)) },
          });
        }
      }

      if (payload.ruleId) {
        await prisma.automationRule.update({ where: { id: payload.ruleId }, data: { lastRunAt: new Date() } });
      }
      await saveJobrightSession(context);
    } finally {
      await context?.close();
    }
  }
);

// Syncs the top of jobright-ai's public "Software Engineer" H1B tracker
// (github.com/jobright-ai/Daily-H1B-Jobs-In-Tech) into the Recommended tab.
// Every linked job already lives on jobright.ai, so this reuses the exact
// same pull-contacts pipeline as run_search - only the source of jobRightIds
// differs. The jobRightId unique constraint plus this findFirst check
// together make re-running the sync (scheduled every 24h, or right after a
// restart) a safe no-op for jobs already known.
jobrightQueue.register("sync_github_h1b", async (payload: { requestedBy: number; limit?: number }) => {
  const entries = await fetchTopSoftwareEngineerJobs(payload.limit ?? 50);
  let context: BrowserContext | null = null;
  try {
    context = await getJobrightContext();
    for (const entry of entries) {
      const existing = await prisma.job.findFirst({ where: { jobRightId: entry.jobRightId } });
      if (existing) continue;

      const job = await prisma.job.create({
        data: {
          url: `https://jobright.ai/jobs/info/${entry.jobRightId}`,
          jobRightId: entry.jobRightId,
          status: "pending",
          addedById: payload.requestedBy,
          source: "github_h1b",
        },
      });

      try {
        await pullAndStoreContacts(context, { id: job.id, jobRightId: entry.jobRightId, url: job.url });
      } catch (e: any) {
        // One bad job in the batch shouldn't sink the rest of the sync.
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "error", errorMessage: sanitizeErrorMessage(String(e?.message || e)) },
        });
      }
    }
    await saveJobrightSession(context);
  } finally {
    await context?.close();
  }
});

// Reads whatever's new in the member's inbox since the last sync (or the
// last 90 days on a first run), classifies each candidate email, and
// upserts one TrackedApplication row per company - see
// automation/emailTracker.ts for the classification rules and why company
// name (not Gmail thread id) is the grouping key.
trackerQueue.register("sync_application_tracker", async (payload: { userId: number }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
  if (!user.trackerEnabled) return;
  if (!user.googleRefreshTokenEnc) throw new Error("Connect Gmail from your Profile page first.");

  let access_token: string;
  try {
    ({ access_token } = await refreshAccessToken(decrypt(user.googleRefreshTokenEnc)));
  } catch (e) {
    // A revoked/expired grant never recovers on its own. Drop the dead token
    // so the Profile page flips back to "not connected" and the member is
    // actually prompted to reconnect.
    if (e instanceof GoogleRefreshTokenRevokedError) {
      await prisma.user.update({
        where: { id: user.id },
        data: { gmailOauthEmail: null, googleRefreshTokenEnc: null },
      });
    }
    throw e;
  }
  const emails = await fetchApplicationEmails(access_token, user.trackerLastSyncAt);

  // Oldest first, so when multiple emails resolve to the same company the
  // last upsert reflects whichever one is actually most recent.
  const ordered = [...emails].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const email of ordered) {
    const classified = classifyEmail(email.subject, email.snippet, email.from);
    if (!classified) continue;

    await prisma.trackedApplication.upsert({
      where: { userId_companyKey: { userId: user.id, companyKey: classified.companyKey } },
      create: {
        userId: user.id,
        company: classified.company,
        companyKey: classified.companyKey,
        roleTitle: classified.roleTitle,
        status: classified.status,
        lastEmailSubject: email.subject,
        lastEmailSnippet: email.snippet,
        lastEmailAt: email.date,
        gmailMessageId: email.id,
      },
      update: {
        company: classified.company,
        roleTitle: classified.roleTitle,
        status: classified.status,
        lastEmailSubject: email.subject,
        lastEmailSnippet: email.snippet,
        lastEmailAt: email.date,
        gmailMessageId: email.id,
      },
    });
  }

  await prisma.user.update({ where: { id: user.id }, data: { trackerLastSyncAt: new Date() } });
});

emailQueue.register(
  "send_email",
  async (payload: { contactId: number; userId: number; subject?: string; body?: string }) => {
    await sleep(EMAIL_MIN_DELAY_MS + Math.random() * (EMAIL_MAX_DELAY_MS - EMAIL_MIN_DELAY_MS));

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: payload.contactId } });
    if (!contact.email) throw new Error("Contact has no email on file");

    // Global de-duplication by email address - never email the same real
    // person twice, even for a different job or a different sender.
    const alreadySent = await prisma.contact.findFirst({
      where: { email: contact.email, status: "sent", id: { not: contact.id } },
    });
    if (alreadySent) {
      await prisma.contact.update({ where: { id: contact.id }, data: { status: "skipped_duplicate" } });
      return;
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.userId } });
    const hasOAuth = !!(user.gmailOauthEmail && user.googleRefreshTokenEnc);
    const hasAppPassword = !!(user.gmailAddress && user.gmailAppPasswordEnc);
    if (!hasOAuth && !hasAppPassword) {
      throw new Error("Connect Gmail via OAuth or set a Gmail address + app password in your profile first");
    }
    const primaryResume = await prisma.resume.findFirst({ where: { userId: user.id, isPrimary: true } });
    if (!primaryResume) {
      throw new Error("You haven't uploaded a resume in your profile yet");
    }

    const subject = payload.subject ?? contact.subject ?? "";
    let body = payload.body ?? contact.body ?? "";
    if (user.signature) body = `${body}\n\n${user.signature}`;

    // A member's own send switch takes priority over the admin's team-wide
    // dry run setting - this is their personal opt-out, not a shared one.
    if (!user.sendEnabled) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "skipped_disabled", subject, body, sentById: user.id, sentAt: new Date() },
      });
      return;
    }

    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const dryRun = settings?.dryRun ?? true;

    if (dryRun) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "dry_run", subject, body, sentById: user.id, sentAt: new Date() },
      });
      return;
    }

    try {
      // OAuth takes priority when a member has both connected - it's the
      // more resilient path (no 16-char app password to expire/get pasted
      // wrong), the manual method stays as a fallback either way.
      await sendOutreachEmail({
        toEmail: contact.email,
        subject,
        body,
        resumePath: resumePathFor(primaryResume.id),
        resumeFilename: primaryResume.filename,
        auth: hasOAuth
          ? { type: "oauth2", fromAddress: user.gmailOauthEmail!, refreshToken: decrypt(user.googleRefreshTokenEnc!) }
          : { type: "app_password", fromAddress: user.gmailAddress!, fromAppPassword: decrypt(user.gmailAppPasswordEnc!) },
      });
      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "sent", subject, body, sentById: user.id, sentAt: new Date() },
      });
    } catch (e: any) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { status: "send_failed", errorMessage: sanitizeErrorMessage(String(e?.message || e)) },
      });
      throw e;
    }
  }
);

export async function startQueues() {
  await jobrightQueue.resume();
  await emailQueue.resume();
  await trackerQueue.resume();
}
