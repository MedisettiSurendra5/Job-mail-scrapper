// Reads a member's Gmail inbox (via the Gmail REST API, using their stored
// OAuth refresh token - see automation/googleOAuth.ts) and classifies
// job-application-related emails into a status, with no external API/LLM
// involved - just keyword/domain matching against the very consistent
// phrasing ATS platforms (Greenhouse, Lever, Workday, etc.) use for their
// auto-replies. Deliberately rule-based: good enough for the common case,
// and doesn't need an API key this project doesn't have.

export type ApplicationStatus = "applied" | "screening" | "phone_interview" | "upcoming_interview" | "rejected";

export interface ClassifiedEmail {
  status: ApplicationStatus;
  company: string;
  companyKey: string;
  roleTitle: string | null;
}

export interface RawApplicationEmail {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: Date;
}

const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
  "ashbyhq.com",
  "workable.com",
  "bamboohr.com",
];

// Checked in this order - rejection phrasing is checked first because a
// rejection email often still contains leftover "thank you for applying"
// boilerplate further down, which would otherwise misclassify it as
// "applied".
const REJECTED_RE =
  /\b(regret to inform|unfortunately|other candidates|not (?:be )?moving forward|will not be moving forward|not selected|decided (?:not )?to (?:proceed|pursue)|pursuing other candidates|position (?:has been|was) filled|not (?:a )?match at this time)\b/i;
const PHONE_INTERVIEW_RE = /\b(phone (?:screen|interview)|recruiter (?:call|screen)|initial screen(?:ing)?)\b/i;
const UPCOMING_INTERVIEW_RE =
  /\b(interview (?:invitation|scheduled|confirmed|request)|schedule (?:a|your) interview|onsite interview|final round|next round|technical interview|panel interview|virtual interview|in-person interview)\b/i;
const SCREENING_RE = /\b(assessment|coding challenge|take[- ]home|online assessment|technical screen)\b/i;
const APPLIED_RE = /\b(application (?:received|submitted|has been received)|thank you for (?:applying|your application)|we(?:'ve| have) received your application)\b/i;

const SUBJECT_COMPANY_PATTERNS = [
  /applying to ([A-Z][\w&.,'-]{1,60}?)[!.,]?\s*$/i,
  /application (?:to|at|with) ([A-Z][\w&.,'-]{1,60}?)(?:[!.,]|\s*$)/i,
  /your ([A-Z][\w&.,'-]{1,60}?) application/i,
  /^([A-Z][\w&.,'-]{1,60}?)\s*[-–|:]\s*(?:application|interview|next steps|update)/i,
];

const STRIP_WORDS_RE = /\b(careers?|recruiting|talent(?: team)?|hiring(?: team)?|human resources|hr|jobs?|team|via greenhouse|via lever)\b\.?/gi;
const CORP_SUFFIX_RE = /,?\s*(inc\.?|llc\.?|ltd\.?|corp(?:oration)?\.?|co\.?)$/i;

function cleanCompanyName(raw: string): string {
  return raw
    .replace(STRIP_WORDS_RE, "")
    .replace(CORP_SUFFIX_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[-–|:,]+$/, "")
    .trim();
}

function extractDisplayName(fromHeader: string): string | null {
  const m = fromHeader.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  return m && m[1].trim() ? m[1].trim() : null;
}

function extractDomain(fromHeader: string): string | null {
  const m = fromHeader.match(/@([\w.-]+\.\w+)>?$/);
  return m ? m[1].toLowerCase() : null;
}

function extractCompany(subject: string, fromHeader: string): string | null {
  for (const re of SUBJECT_COMPANY_PATTERNS) {
    const m = subject.match(re);
    if (m?.[1]) {
      const cleaned = cleanCompanyName(m[1]);
      if (cleaned) return cleaned;
    }
  }
  const displayName = extractDisplayName(fromHeader);
  if (displayName) {
    const cleaned = cleanCompanyName(displayName);
    if (cleaned) return cleaned;
  }
  return null;
}

function extractRoleTitle(subject: string): string | null {
  const m = subject.match(/for (?:the )?([A-Z][\w\s/&-]{2,60}?) (?:position|role|opening)\b/i);
  return m ? m[1].trim() : null;
}

function normalizeCompanyKey(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Returns null when the email doesn't look job-related at all (not from a
// known ATS domain and no matching phrasing) or when no company name could
// be pinned down - both cases mean "skip this one" to the caller.
export function classifyEmail(subject: string, snippet: string, fromHeader: string): ClassifiedEmail | null {
  const text = `${subject}\n${snippet}`;
  const domain = extractDomain(fromHeader);
  const isKnownAts = domain ? ATS_DOMAINS.some((d) => domain.endsWith(d)) : false;

  let status: ApplicationStatus | null = null;
  if (REJECTED_RE.test(text)) status = "rejected";
  else if (PHONE_INTERVIEW_RE.test(text)) status = "phone_interview";
  else if (UPCOMING_INTERVIEW_RE.test(text)) status = "upcoming_interview";
  else if (SCREENING_RE.test(text)) status = "screening";
  else if (APPLIED_RE.test(text) || isKnownAts) status = "applied";

  if (!status) return null;

  const company = extractCompany(subject, fromHeader);
  if (!company) return null;

  return { status, company, companyKey: normalizeCompanyKey(company), roleTitle: extractRoleTitle(subject) };
}

function getHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

async function gmailFetch(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Reconnect Gmail from your Profile page to grant read access.");
    }
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Gmail API request failed (${res.status})`);
  }
  return res.json();
}

const MAX_MESSAGES_PER_SYNC = 100;

// Narrows the fetch with Gmail's own search syntax (known ATS sender domains
// OR application/interview/assessment/rejection keywords in the subject)
// before any classification happens, so a sync only ever pulls the handful
// of messages that could plausibly be job-related, not the whole inbox.
export async function fetchApplicationEmails(accessToken: string, sinceDate: Date | null): Promise<RawApplicationEmail[]> {
  const days = sinceDate
    ? Math.min(365, Math.max(1, Math.ceil((Date.now() - sinceDate.getTime()) / 86_400_000)))
    : 90;
  const atsTerms = ATS_DOMAINS.map((d) => `from:${d}`).join(" OR ");
  const keywordTerms = ["subject:application", "subject:interview", '"phone screen"', "subject:assessment", "subject:rejected"].join(" OR ");
  const q = `newer_than:${days}d (${atsTerms} OR ${keywordTerms}) -in:chats -in:spam -in:trash`;

  const list = await gmailFetch(accessToken, `/messages?maxResults=${MAX_MESSAGES_PER_SYNC}&q=${encodeURIComponent(q)}`);
  const ids: string[] = (list.messages || []).map((m: { id: string }) => m.id);

  const emails: RawApplicationEmail[] = [];
  for (const id of ids) {
    const msg = await gmailFetch(accessToken, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    emails.push({
      id,
      subject: getHeader(msg.payload?.headers, "Subject"),
      from: getHeader(msg.payload?.headers, "From"),
      snippet: msg.snippet || "",
      date: new Date(Number(msg.internalDate)),
    });
  }
  return emails;
}
