// SQLite has no native enum support, so the corresponding Prisma columns are
// plain strings (see prisma/schema.prisma) - these are the allowed values,
// enforced in application code instead of by the database.

export type Role = "admin" | "member";
export type JobStatus = "pending" | "ready" | "error";
export type ContactStatus =
  | "found"
  | "no_email_found"
  | "sent"
  | "send_failed"
  | "skipped_duplicate"
  | "skipped_disabled"
  | "dry_run";
export type TaskType = "add_job" | "pull_emails" | "send_email" | "run_search" | "sync_github_h1b";
export type TaskStatus = "queued" | "running" | "done" | "failed";

// Verified live against JobRight's search filter dropdowns
// (data-preference-key: country, seniority, jobTypes, workModel, daysAgo).
export const FILTER_OPTIONS = {
  country: ["United States"],
  seniority: ["Intern/New Grad", "Entry Level", "Mid Level", "Senior Level", "Lead/Staff", "Director/Executive"],
  jobTypes: ["Full-time", "Contract", "Part-time", "Internship"],
  workModel: ["Onsite", "Hybrid", "Remote anywhere in the US"],
  daysAgo: ["Past 24 hours", "Past 3 days", "Past week", "Past month"],
} as const;

export interface SearchFilters {
  searchTerm: string;
  applyFilters: boolean;
  country?: string[];
  company?: string;
  seniority?: string[];
  jobTypes?: string[];
  workModel?: string[];
  daysAgo?: string;
}

export type PlanId = "free" | "pro" | "elite";

export const PLANS: Record<PlanId, { name: string; priceUsd: number; dailyActionLimit: number | null; humanAssistance: boolean; maxResumes: number }> = {
  free: { name: "Free", priceUsd: 0, dailyActionLimit: 3, humanAssistance: false, maxResumes: 1 },
  pro: { name: "Pro", priceUsd: 49, dailyActionLimit: null, humanAssistance: false, maxResumes: 5 },
  elite: { name: "Elite", priceUsd: 299, dailyActionLimit: null, humanAssistance: true, maxResumes: 5 },
};
