import { BrowserContext, Page, chromium, errors as playwrightErrors } from "playwright";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../db";
import { decrypt } from "../crypto";
import { env } from "../env";
import { storageStatePath } from "../paths";
import { SearchFilters } from "../types";

const PWTimeoutError = playwrightErrors.TimeoutError;

const MIN_DELAY = 1500;
const MAX_DELAY = 3500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanPause(lo = MIN_DELAY, hi = MAX_DELAY) {
  return sleep(lo + Math.random() * (hi - lo));
}

async function safeWait(page: Page, timeout = 8000) {
  try {
    await page.waitForLoadState("networkidle", { timeout });
  } catch {
    /* fine, best-effort */
  }
}

async function dismissAnyModal(page: Page): Promise<boolean> {
  try {
    const closeBtn = page.locator(".ant-modal-close");
    if ((await closeBtn.count()) && (await closeBtn.first().isVisible())) {
      await closeBtn.first().click({ timeout: 3000 });
      await sleep(600);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function dismissOrionPopup(page: Page) {
  try {
    const exitBtn = page.getByText("EXIT", { exact: false }).first();
    if (await exitBtn.isVisible()) {
      await exitBtn.click({ timeout: 2000 });
      await sleep(600);
    }
  } catch {
    /* ignore */
  }

  // The Orion onboarding tour (react-tour) renders a full-viewport spotlight
  // mask (#___reactour) that intercepts clicks anywhere on the page - it can
  // outlive its own "EXIT" button (already dismissed, or never shown this
  // pass) and silently block every subsequent click. Setting pointer-events
  // on the container alone doesn't help - the tour's SVG mask sets its own
  // pointer-events="auto" attribute directly, which overrides an ancestor's
  // CSS. Since we're driving the browser for scraping, not taking the tour,
  // just remove it from rendering entirely.
  try {
    const overlay = page.locator("#___reactour");
    if (await overlay.count()) {
      await page.evaluate(() => {
        (globalThis as any).document.querySelectorAll("#___reactour").forEach((el: any) => {
          el.style.display = "none";
        });
      });
    }
  } catch {
    /* ignore */
  }
}

// jobright pops up promo modals at unpredictable moments, which silently
// intercept clicks anywhere in the flow. Dismiss whatever's blocking and
// retry rather than failing outright.
async function robustClick(page: Page, locator: ReturnType<Page["locator"]>, retries = 5, timeout = 3000, pause = 800) {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    await dismissOrionPopup(page);
    await dismissAnyModal(page);
    try {
      await locator.click({ timeout });
      return;
    } catch (e) {
      lastErr = e;
      await sleep(pause);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Shared browser/session management - one JobRight login shared by everyone.
// ---------------------------------------------------------------------------

let sharedBrowser: import("playwright").Browser | null = null;

async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({ headless: env.headless });
    // If Chromium crashes (e.g. OOM/low /dev/shm) the stale reference must
    // not stick around - every future job would hang forever trying to use
    // a dead browser instead of launching a fresh one.
    sharedBrowser.on("disconnected", () => {
      sharedBrowser = null;
    });
  }
  return sharedBrowser;
}

// Captures a screenshot + HTML snapshot of whatever the (headless) browser
// is actually showing when a login step fails - a plain Playwright timeout
// message doesn't say whether jobright.ai changed its markup, is showing a
// bot-check/CAPTCHA, or something else entirely, and there's no way to
// attach a debugger to the headless instance to look ourselves.
async function dumpDebugState(page: Page, label: string) {
  try {
    const dir = path.join(env.dataDir, "debug");
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(dir, `${stamp}-${label}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    await fs.writeFile(`${base}.html`, await page.content()).catch(() => {});
  } catch {
    /* best-effort diagnostic only, never let it mask the real error */
  }
}

async function loginFresh(page: Page, jrEmail: string, jrPassword: string) {
  await page.goto("https://jobright.ai/", { waitUntil: "domcontentloaded" });
  await sleep(2000);

  try {
    await robustClick(page, page.getByText("Sign in", { exact: false }).first(), 5, 6000);
  } catch (e) {
    await dumpDebugState(page, "login-open-modal-failed");
    throw e;
  }
  await sleep(1500);

  await page.getByPlaceholder("Email").fill(jrEmail, { timeout: 10000 });
  await page.getByPlaceholder("Password").fill(jrPassword, { timeout: 10000 });
  try {
    await robustClick(page, page.getByRole("button", { name: "Sign in", exact: false }).first(), 5, 6000);
  } catch (e) {
    await dumpDebugState(page, "login-submit-failed");
    throw e;
  }

  await safeWait(page);
  await sleep(2000);
}

// Returns a logged-in BrowserContext, reusing the saved session when
// possible. Only one caller should hold this at a time (enforced by the
// jobrightQueue's concurrency=1), since a second concurrent login could
// invalidate the shared session.
export async function getJobrightContext(): Promise<BrowserContext> {
  const config = await prisma.jobRightConfig.findUnique({ where: { id: 1 } });
  if (!config) throw new Error("The job search account has not been configured yet (admin setup required)");

  const browser = await getBrowser();
  const jrPassword = decrypt(config.passwordEnc);

  const context = config.storageStateJson
    ? await browser.newContext({ storageState: JSON.parse(config.storageStateJson) })
    : await browser.newContext();

  // Nothing has taken ownership of `context` yet, so a throw from here on
  // would leak it - the callers' `finally { context.close() }` only runs once
  // they've actually received one. A single failing login per retry is
  // harmless; an automation rule retrying hourly is not.
  let page: Page | null = null;
  try {
    page = await context.newPage();
    await page.goto("https://jobright.ai/jobs/recommend", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const loggedOut = await page
      .getByText("Sign in", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);

    if (loggedOut) {
      await loginFresh(page, config.email, jrPassword);
      await saveJobrightSession(context);
      await page.goto("https://jobright.ai/jobs/recommend", { waitUntil: "domcontentloaded" });
      await sleep(1500);
    }

    await page.close();
    return context;
  } catch (e) {
    await page?.close().catch(() => {});
    await context.close().catch(() => {});
    throw e;
  }
}

// Persists the live cookies/localStorage back to both the DB (what
// getJobrightContext reads) and the data volume (what seed() reads on a fresh
// DB). Called after every successful task, not just after a fresh login, so
// JobRight's rolling session refreshes are retained instead of being
// discarded the moment the context closes.
export async function saveJobrightSession(context: BrowserContext): Promise<void> {
  try {
    const storageStateJson = JSON.stringify(await context.storageState());
    await prisma.jobRightConfig.update({ where: { id: 1 }, data: { storageStateJson } });
    await fs.writeFile(storageStatePath, storageStateJson);
  } catch (e) {
    // A task that already did its real work must not be reported as failed
    // just because the session snapshot couldn't be written.
    console.warn("Could not persist the JobRight session:", e);
  }
}

// ---------------------------------------------------------------------------
// Searching JobRight's own job feed (as opposed to adding a single job by
// URL). Ported from jobright_automation.py, plus additional filter
// categories (country, work model, expanded seniority/job-type/date-posted
// options, and a free-text company filter) confirmed live against the
// site's filter dropdowns before being wired up here.
// ---------------------------------------------------------------------------

async function searchJobs(page: Page, term: string) {
  const box = page.getByPlaceholder("Search by title or company", { exact: false });
  await robustClick(page, box.first(), 5, 6000);
  await box.first().fill(term);
  await box.first().press("Enter");
  await safeWait(page);
  await sleep(3000);
  await dismissOrionPopup(page);
  await dismissAnyModal(page);
}

// Checkbox-style dropdown filters (country, seniority, jobTypes, workModel,
// daysAgo) all share this shape: click the trigger, tick each requested
// label, click Confirm.
async function applyCheckboxFilter(page: Page, prefKey: string, optionLabels: string[]) {
  if (!optionLabels.length) return;
  await robustClick(page, page.locator(`[data-preference-key="${prefKey}"]`).first(), 5, 6000);
  await sleep(1000);
  for (const label of optionLabels) {
    const opt = page.locator("label.ant-checkbox-wrapper, label.ant-radio-wrapper", { hasText: label }).first();
    // This panel's own render/debounce can genuinely take longer than the
    // rest of the site under load (seen live: intermittent timeouts here
    // even with retries) - same "give it much more room" treatment already
    // used for the job-detail JSON extraction below.
    await robustClick(page, opt, 5, 6000);
    await sleep(600);
  }
  // The Confirm button's accessible name includes a live result count, e.g.
  // "Confirm(26)" - must use a substring match, not exact.
  const confirm = page.getByRole("button", { name: "Confirm", exact: false }).first();
  await robustClick(page, confirm, 5, 6000);
  await sleep(1200);
}

// The company filter is a free-text/autocomplete input (not a fixed option
// list) - type the name, pick the matching suggestion if one appears, then
// Confirm.
async function applyCompanyFilter(page: Page, company: string) {
  if (!company.trim()) return;
  await robustClick(page, page.locator('[data-preference-key="companies"]').first(), 5, 6000);
  await sleep(800);
  const input = page.getByPlaceholder("Enter Company", { exact: false });
  await input.fill(company);
  await sleep(1200);
  try {
    await page.locator(".ant-select-item-option", { hasText: company }).first().click({ timeout: 3000 });
  } catch {
    // No matching suggestion - fall back to whatever was typed.
  }
  const confirm = page.getByRole("button", { name: "Confirm", exact: false }).first();
  await robustClick(page, confirm, 3, 2500);
  await sleep(1200);
}

async function applySearchFilters(page: Page, filters: SearchFilters) {
  if (!filters.applyFilters) return;
  if (filters.country?.length) await applyCheckboxFilter(page, "country", filters.country);
  if (filters.company) await applyCompanyFilter(page, filters.company);
  if (filters.seniority?.length) await applyCheckboxFilter(page, "seniority", filters.seniority);
  if (filters.jobTypes?.length) await applyCheckboxFilter(page, "jobTypes", filters.jobTypes);
  if (filters.workModel?.length) await applyCheckboxFilter(page, "workModel", filters.workModel);
  if (filters.daysAgo) await applyCheckboxFilter(page, "daysAgo", [filters.daysAgo]);
}

async function getResultCount(page: Page): Promise<number | null> {
  try {
    const text = await page.getByText(/\d+ results for/, { exact: false }).first().innerText({ timeout: 3000 });
    const m = text.match(/(\d+) results/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

// The results list is virtualized - only cards near the viewport exist in
// the DOM. Scroll repeatedly, collecting job card ids as they mount, until
// scrolling stops revealing new ones or maxPerRun is reached.
async function collectJobIds(page: Page, maxPerRun: number, maxScrolls = 60): Promise<string[]> {
  const expected = await getResultCount(page);
  const seen: string[] = [];
  const seenSet = new Set<string>();

  const currentIds = () =>
    page.locator('div[class*="index_job-card__"]').evaluateAll((els: any[]) =>
      els.map((e) => e.id).filter(Boolean)
    ) as Promise<string[]>;

  for (const id of await currentIds()) {
    if (!seenSet.has(id)) {
      seenSet.add(id);
      seen.push(id);
    }
  }

  let stagnant = 0;
  for (let i = 0; i < maxScrolls; i++) {
    if (seen.length >= maxPerRun || (expected !== null && seen.length >= expected)) break;
    try {
      await page.locator('div[class*="index_job-card__"]').last().scrollIntoViewIfNeeded({ timeout: 3000 });
    } catch {
      await page.mouse.wheel(0, 900);
    }
    await sleep(1000);

    const before = seen.length;
    for (const id of await currentIds()) {
      if (!seenSet.has(id)) {
        seenSet.add(id);
        seen.push(id);
      }
    }
    stagnant = seen.length === before ? stagnant + 1 : 0;
    if (stagnant >= 4) break;
  }

  return seen.slice(0, maxPerRun);
}

export async function runSearch(context: BrowserContext, filters: SearchFilters, maxPerRun: number): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto("https://jobright.ai/jobs/recommend", { waitUntil: "domcontentloaded" });
    await sleep(1500);
    await searchJobs(page, filters.searchTerm);
    await applySearchFilters(page, filters);
    await safeWait(page);
    await sleep(1000);
    return await collectJobIds(page, maxPerRun);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Reading job data + insider connections (same for search-found and
// externally-added jobs - both expose the same embedded JSON blob).
// ---------------------------------------------------------------------------

interface SocialConnection {
  fullName?: string;
  linkedinUrl?: string;
}

interface JobJson {
  jobResult: {
    jobId: string;
    jobTitle: string;
    applyLink?: string;
    originalUrl?: string;
    socialConnections?: SocialConnection[];
    jobLocation?: string;
    jobSeniority?: string;
    employmentType?: string;
    workModel?: string;
    publishTime?: string;
  };
  companyResult: { companyName: string };
}

// jobright's publishTime ("YYYY-MM-DD HH:MM:SS") carries no timezone marker,
// and which zone the clock digits are actually in isn't verifiable - parse
// the literal digits as UTC (not `new Date(str)`, which is Node-TZ-dependent)
// so storage is deterministic across environments. Only used for day-level
// display/filtering, not anything needing wall-clock precision.
export function parsePublishTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// By far the most common failure in practice was this element timing out at
// 8s - the job board's page is heavy with third-party analytics/tracking
// scripts, and hydration can genuinely take longer than that under normal
// network conditions (not just the tour-overlay issue fixed elsewhere). Give
// it much more room, and reload once before giving up in case the first
// load just stalled.
async function extractJobJson(page: Page): Promise<JobJson> {
  const locator = page.locator("#jobright-helper-job-detail-info");
  try {
    const raw = await locator.innerText({ timeout: 25000 });
    return JSON.parse(raw);
  } catch (e) {
    if (!(e instanceof PWTimeoutError)) throw e;
    await page.reload({ waitUntil: "domcontentloaded" });
    await safeWait(page);
    await sleep(1500);
    const raw = await locator.innerText({ timeout: 25000 });
    return JSON.parse(raw);
  }
}

async function expandAllConnectionGroups(page: Page) {
  const viewButtons = page.getByRole("button", { name: "View", exact: false });
  const count = await viewButtons.count();
  for (let i = 0; i < count; i++) {
    try {
      await robustClick(page, viewButtons.nth(i), 3, 3000);
    } catch {
      continue;
    }
    try {
      await page.locator('button:has(img[alt="mail-icon"])').first().waitFor({ state: "visible", timeout: 8000 });
    } catch (e) {
      if (!(e instanceof PWTimeoutError)) throw e;
    }
  }
}

// jobright's rich-text editor renders each blank line as its own <p><br></p>,
// which .innerText() turns into runs of several blank lines. Collapse any
// run of 2+ blank lines down to exactly one.
function cleanEmailBody(raw: string): string {
  return raw.trim().replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
}

// Collapses all internal whitespace, not just the outer edges - needed
// because the job board's own fullName field can contain double spaces.
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Adding a job by external URL - JobRight's "External" tab exposes a clean
// JSON API for this (found by capturing network traffic while driving the
// UI form manually): POST job-by-url to kick off a crawl, poll status until
// extracted, then POST the extracted fields to save it. No DOM form-filling
// needed, which is far more robust than clicking through the UI.
// ---------------------------------------------------------------------------

interface ExtractedJob {
  company: { company_name: string; company_id: string; linkedin_company_id: number };
  job_title: string;
  job_description: string;
}

export async function addExternalJob(context: BrowserContext, url: string): Promise<{ jobId: string; title: string; company: string }> {
  // A one-off network blip here shouldn't fail the whole add - retry once
  // before giving up.
  let kickoffJson: any;
  try {
    const kickoff = await context.request.post("https://jobright.ai/swan/import/job-by-url", { data: { url } });
    kickoffJson = await kickoff.json();
  } catch (e) {
    if (!(e instanceof PWTimeoutError)) throw e;
    const kickoff = await context.request.post("https://jobright.ai/swan/import/job-by-url", { data: { url } });
    kickoffJson = await kickoff.json();
  }

  // JobRight already knows about this URL (it's in the main job database,
  // not just a fresh external add) - the "View Job" path in the UI. Nothing
  // new to save; just use the existing job id directly.
  if (kickoffJson.result?.status === "EXISTING_JOB" && kickoffJson.result?.jobId) {
    const existing = kickoffJson.result.job;
    return {
      jobId: kickoffJson.result.jobId,
      title: existing?.job_title || "",
      company: existing?.company?.company_name || "",
    };
  }

  // Some URLs (e.g. one copied from the job board's own job page rather than
  // the original posting) get extracted synchronously - the kickoff response
  // itself already carries status EXTRACTED_JOB with no crawler_id to poll.
  let extracted: ExtractedJob | null =
    kickoffJson.result?.status === "EXTRACTED_JOB" ? kickoffJson.result.job : null;

  if (!extracted) {
    const crawlerId = kickoffJson.result?.crawler_id;
    if (!crawlerId) throw new Error(`That URL could not be processed: ${kickoffJson.errorMsg || "unknown error"}`);

    for (let i = 0; i < 30; i++) {
      await sleep(1500);
      const statusResp = await context.request.get(
        `https://jobright.ai/swan/import/job-by-url/status?crawler_id=${crawlerId}`
      );
      const statusJson = await statusResp.json();
      const status = statusJson.result?.status;
      if (status === "EXTRACTED_JOB") {
        extracted = statusJson.result.job;
        break;
      }
      // Only bail out on statuses that actually signal failure - anything
      // else (PENDING, CRAWLING_JOB, or any other in-progress state) just
      // means keep polling.
      if (status && /fail|error/i.test(status)) {
        throw new Error(`Couldn't extract details from that job posting (status: ${status})`);
      }
    }
    if (!extracted) throw new Error("Timed out while looking up that job posting");
  }

  // The crawler can report success but still come back with no usable
  // company data for a page it couldn't really parse (e.g. a generic/non-job
  // URL) - fail with a clear message instead of crashing on a null field.
  if (!extracted.company || !extracted.job_title) {
    throw new Error("Couldn't extract enough details from that job posting - try pasting the original job listing URL");
  }

  const saveResp = await context.request.post("https://jobright.ai/swan/import/job", {
    data: {
      jobTitle: extracted.job_title,
      url,
      companyName: extracted.company.company_name,
      jobDescription: extracted.job_description,
      companyId: String(extracted.company.linkedin_company_id ?? extracted.company.company_id),
    },
  });
  const saveJson = await saveResp.json();
  const jobId = saveJson.result;
  if (!jobId || typeof jobId !== "string") {
    throw new Error(`Something went wrong saving that job: ${JSON.stringify(saveJson)}`);
  }

  return { jobId, title: extracted.job_title, company: extracted.company.company_name };
}

// ---------------------------------------------------------------------------
// Pulling Insider Connection contacts for a job (scrape only - sending is a
// separate step done per-user with their own Gmail credentials).
// ---------------------------------------------------------------------------

export interface PulledContact {
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  subject: string;
  body: string;
  status: "found" | "no_email_found";
}

export interface PulledJob {
  title: string;
  company: string;
  applyUrl: string;
  location: string;
  employmentType: string;
  workModel: string;
  seniority: string;
  datePosted: Date | null;
  contacts: PulledContact[];
}

// Fallback for when the embedded JSON's applyLink/originalUrl come back empty
// (seen on some listings, e.g. search/github_h1b-sourced jobs whose only URL
// otherwise is our own synthetic jobright.ai info-page link) - the rendered
// page also carries a plain "Original Job Post" link pointing at the same
// real posting, confirmed live to match applyLink/originalUrl when both are
// present. Read it directly rather than leaving applyUrl empty.
async function findOriginalJobPostLink(page: Page): Promise<string | null> {
  try {
    const link = page.getByRole("link", { name: "Original Job Post", exact: false }).first();
    if (await link.count()) {
      const href = await link.getAttribute("href");
      if (href) return href;
    }
  } catch {
    /* best-effort fallback only - never let this fail the whole pull */
  }
  return null;
}

export async function pullContactsForJob(context: BrowserContext, jobId: string): Promise<PulledJob> {
  const page = await context.newPage();
  try {
    await page.goto(`https://jobright.ai/jobs/info/${jobId}`, { waitUntil: "domcontentloaded" });
    await safeWait(page);
    await sleep(1500);
    await dismissOrionPopup(page);
    await dismissAnyModal(page);

    const data = await extractJobJson(page);
    const title = data.jobResult.jobTitle;
    const company = data.companyResult.companyName;
    const applyUrl = data.jobResult.applyLink || data.jobResult.originalUrl || (await findOriginalJobPostLink(page)) || "";
    const location = data.jobResult.jobLocation || "";
    const employmentType = data.jobResult.employmentType || "";
    const workModel = data.jobResult.workModel || "";
    const seniority = data.jobResult.jobSeniority || "";
    const datePosted = parsePublishTime(data.jobResult.publishTime);
    const connections = data.jobResult.socialConnections || [];

    // The job JSON already includes each connection's LinkedIn profile URL -
    // match it to the contact revealed via the mail-icon click by full name,
    // since the reveal panel and this list aren't guaranteed to be in the
    // same order. The job board's own fullName field can contain internal
    // double spaces (e.g. a firstName with a trailing space concatenated
    // with the last name), which a plain .trim() doesn't fix - collapse all
    // internal whitespace too so it actually matches the cleanly-scraped
    // name from the reveal panel.
    const linkedinByName = new Map<string, string>();
    for (const c of connections) {
      if (c.fullName && c.linkedinUrl) linkedinByName.set(normalizeName(c.fullName), c.linkedinUrl);
    }

    if (!connections.length) {
      return { title, company, applyUrl, location, employmentType, workModel, seniority, datePosted, contacts: [] };
    }

    try {
      await page.getByText("Insider Connection", { exact: false }).first().scrollIntoViewIfNeeded({ timeout: 5000 });
      await sleep(1000);
    } catch {
      /* ignore, not fatal */
    }

    await expandAllConnectionGroups(page);

    const mailButtons = page.locator('button:has(img[alt="mail-icon"])');
    const n = await mailButtons.count();
    const contacts: PulledContact[] = [];

    for (let i = 0; i < n; i++) {
      try {
        const contact = await revealContact(page, mailButtons.nth(i), linkedinByName);
        if (contact) contacts.push(contact);
      } catch {
        await dismissAnyModal(page);
      }
      await humanPause();
    }

    return { title, company, applyUrl, location, employmentType, workModel, seniority, datePosted, contacts };
  } finally {
    await page.close();
  }
}

async function revealContact(
  page: Page,
  mailButton: ReturnType<Page["locator"]>,
  linkedinByName: Map<string, string>
): Promise<PulledContact | null> {
  await robustClick(page, mailButton, 5, 4000);
  await sleep(1500);

  let name = "";
  let title = "";
  try {
    name = (await page.locator('[class*="finish-card-name"]').first().innerText({ timeout: 3000 })).trim();
    title = (await page.locator('[class*="finish-card-contact-job"]').first().innerText({ timeout: 3000 })).trim();
  } catch {
    /* ignore, best-effort */
  }
  const linkedinUrl = linkedinByName.get(normalizeName(name)) || "";

  // jobright sometimes can't find a work email at all for a contact - the
  // panel then reads "Contact Info Not Found!" and offers "Connect On
  // LinkedIn" instead of "Connect Now".
  const connectBtn = page.getByRole("button", { name: "Connect Now", exact: false }).first();
  try {
    await connectBtn.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    return { name, title, email: "", linkedinUrl, subject: "", body: "", status: "no_email_found" };
  }
  await robustClick(page, connectBtn, 5, 4000);
  await sleep(1500);

  const emailInput = page.locator("#email");
  try {
    await emailInput.waitFor({ state: "visible", timeout: 6000 });
  } catch {
    await dismissAnyModal(page);
    return { name, title, email: "", linkedinUrl, subject: "", body: "", status: "no_email_found" };
  }

  const email = ((await emailInput.inputValue()) || "").trim().toLowerCase();
  const subject = ((await page.locator("#subject").inputValue()) || "").trim();
  // The job board drafts using the one shared login's own name, but every
  // member sends with their own identity/signature - drop whatever name the
  // draft signs off with and keep only "Best regards," so each member's own
  // signature (appended at send time) is what actually shows underneath.
  const rawBody = cleanEmailBody(await page.locator("#body .ql-editor").innerText({ timeout: 3000 }));
  const signoffMatch = rawBody.match(/best regards[,:.!]?/i);
  const draftBody =
    signoffMatch && signoffMatch.index !== undefined
      ? rawBody.slice(0, signoffMatch.index + signoffMatch[0].length).trimEnd()
      : rawBody;
  // Every outreach email should end on the same polite note before the
  // sender's personal signature gets appended at send time - but the
  // job board's own draft often already includes this exact line (just
  // ahead of its own "Best regards" sign-off), so don't double it up.
  const CLOSING_LINE = "Thank you for your time and assistance.";
  const body = draftBody.toLowerCase().includes(CLOSING_LINE.toLowerCase()) ? draftBody : `${draftBody}\n\n${CLOSING_LINE}`;

  await dismissAnyModal(page); // close "Connect Via Email" - we send via our own SMTP, not "Start Email"

  if (!email) return { name, title, email: "", linkedinUrl, subject: "", body: "", status: "no_email_found" };
  return { name, title, email, linkedinUrl, subject, body, status: "found" };
}

export async function closeSharedBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}
