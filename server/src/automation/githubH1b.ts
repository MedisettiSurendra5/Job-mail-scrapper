// Pulls the "Software Engineer" job table out of jobright-ai's public H1B
// tracker repo (README.md, refreshed daily upstream) and returns the
// jobright.ai job ids it links to, in the order they appear (newest first
// in that file). Every link in that table already points at a
// jobright.ai/jobs/info/<id> page, so the ids drop straight into the same
// pullContactsForJob flow used for search-discovered jobs - no separate
// "external URL" crawl needed.

const README_URL = "https://raw.githubusercontent.com/jobright-ai/Daily-H1B-Jobs-In-Tech/master/README.md";

export interface GithubH1bEntry {
  jobRightId: string;
  datePosted: Date | null;
}

// jobright's Date Posted column is a plain "YYYY-MM-DD" with no time/zone -
// parse as UTC midnight, same convention as parsePublishTime in jobright.ts.
function parseDateOnly(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

// Scopes parsing to the table between `<summary>Software Engineer</summary>`
// and the following `</details>` - the README also has Marketing, Product
// Manager, and Arts & Design tables using the same layout, which must not
// leak in here.
function extractSoftwareEngineerSection(markdown: string): string {
  const summaryMatch = markdown.match(/<summary>\s*Software Engineer\s*<\/summary>/i);
  if (!summaryMatch || summaryMatch.index === undefined) {
    throw new Error("Couldn't find the Software Engineer section in the H1B tracker README");
  }
  const start = summaryMatch.index + summaryMatch[0].length;
  const end = markdown.indexOf("</details>", start);
  return markdown.slice(start, end === -1 ? undefined : end);
}

// Each data row is a `| ... |` markdown table line containing an
// `[apply](https://jobright.ai/jobs/info/<id>...)` link and ending with a
// `| YYYY-MM-DD |` date-posted column. Column counts vary row to row (some
// rows carry an extra location cell), so this matches on the link + trailing
// date directly rather than assuming a fixed column layout.
const ROW_RE = /\[apply\]\(https:\/\/jobright\.ai\/jobs\/info\/([a-zA-Z0-9]+)[^)]*\)[^|]*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/g;

function parseRows(section: string): GithubH1bEntry[] {
  const entries: GithubH1bEntry[] = [];
  const seen = new Set<string>();
  for (const match of section.matchAll(ROW_RE)) {
    const [, jobRightId, dateStr] = match;
    if (seen.has(jobRightId)) continue;
    seen.add(jobRightId);
    entries.push({ jobRightId, datePosted: parseDateOnly(dateStr) });
  }
  return entries;
}

export async function fetchTopSoftwareEngineerJobs(limit: number): Promise<GithubH1bEntry[]> {
  const res = await fetch(README_URL);
  if (!res.ok) throw new Error(`Failed to fetch H1B tracker README (${res.status})`);
  const markdown = await res.text();
  const section = extractSoftwareEngineerSection(markdown);
  return parseRows(section).slice(0, limit);
}
