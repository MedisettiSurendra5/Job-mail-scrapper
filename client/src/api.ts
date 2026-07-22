const BASE = "/api";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
    }
    return res.json();
  },
};

export { ApiError };

export interface User {
  id: number;
  email: string;
  role: "admin" | "member";
}

export interface Profile {
  id: number;
  email: string;
  role: "admin" | "member";
  gmailAddress: string | null;
  hasGmailAppPassword: boolean;
  gmailOauthEmail: string | null;
  hasGoogleOAuth: boolean;
  resumeFilename: string | null;
  signature: string | null;
  sendEnabled: boolean;
}

export interface Job {
  id: number;
  url: string;
  applyUrl: string | null;
  jobRightId: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  workModel: string | null;
  seniority: string | null;
  datePosted: string | null;
  status: "pending" | "ready" | "error";
  errorMessage: string | null;
  applied: boolean;
  appliedAt: string | null;
  addedById: number;
  createdAt: string;
  addedBy?: { email: string };
  _count?: { contacts: number };
}

export interface Contact {
  id: number;
  jobId: number;
  name: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  subject: string | null;
  body: string | null;
  status: "found" | "no_email_found" | "sent" | "send_failed" | "skipped_duplicate" | "skipped_disabled" | "dry_run";
  sentById: number | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentBy?: { email: string } | null;
}

export interface Task {
  id: number;
  type: "add_job" | "pull_emails" | "send_email" | "run_search";
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
}

export interface FilterOptions {
  country: string[];
  seniority: string[];
  jobTypes: string[];
  workModel: string[];
  daysAgo: string[];
}

export interface SearchParams {
  searchTerm: string;
  applyFilters: boolean;
  country: string[];
  company: string;
  seniority: string[];
  jobTypes: string[];
  workModel: string[];
  daysAgo: string;
  maxPerRun: number;
}

export interface AutomationRule extends SearchParams {
  id: number;
  name: string;
  autoSend: boolean;
  sendAsUserId: number | null;
  sendAsEmail?: string;
  createdByEmail?: string;
  intervalHours: number;
  enabled: boolean;
  lastRunAt: string | null;
}

export type PlanId = "free" | "pro" | "elite";

export const PLAN_CATALOG: Record<PlanId, { name: string; priceUsd: number; dailyActionLimit: number | null; humanAssistance: boolean }> = {
  free: { name: "Free", priceUsd: 0, dailyActionLimit: 3, humanAssistance: false },
  pro: { name: "Pro", priceUsd: 49, dailyActionLimit: null, humanAssistance: false },
  elite: { name: "Elite", priceUsd: 299, dailyActionLimit: null, humanAssistance: true },
};

export interface BillingInfo {
  plan: PlanId;
  effectivePlan: PlanId;
  planExpiresAt: string | null;
  daysRemaining: number | null;
  dailyUsage: { used: number; limit: number | null } | null;
}

export interface BulkUploadResult {
  queued: number;
  skipped: { row: number; reason: string }[];
}

export interface PromoCode {
  id: number;
  code: string;
  planTarget: PlanId;
  durationDays: number;
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt: string | null;
  createdAt: string;
}
