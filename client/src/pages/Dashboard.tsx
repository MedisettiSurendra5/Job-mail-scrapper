import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { BillingInfo, FilterOptions, Job, SearchParams, Task } from "../api";
import { usePollTask } from "../useTaskPolling";
import { CheckboxGroup } from "../CheckboxGroup";
import { JobCalendar } from "../JobCalendar";
import { useToast } from "../Toast";
import { useAuth } from "../AuthContext";

const SEARCH_FILTERS_STORAGE_KEY = "jobSearchFilters";

const TASK_LABEL: Record<Task["type"], string> = {
  add_job: "Adding job",
  pull_emails: "Pulling contacts",
  send_email: "Sending resume",
  run_search: "Search",
  sync_github_h1b: "Recommended sync",
  sync_application_tracker: "Syncing applications",
};

const RECOMMENDED_LIMIT = 50;

function StatusChip({ job }: { job: Job }) {
  const label = { pending: "Adding...", ready: "Ready", error: "Error" }[job.status];
  return <span className={`chip chip-${job.status}`}>{label}</span>;
}

// Search-found jobs are created with a placeholder jobright.ai info-page
// link as their url, then get their real title/company filled in afterward
// (one job's contacts are pulled at a time, so this can take a bit) - show a
// clear "still loading" message instead of that meaningless internal URL.
export function jobDisplayTitle(job: Job): string {
  if (job.title) return job.title;
  if (job.status === "pending") return "Loading job details...";
  return job.url;
}

function jobMetaLine(job: Job): string {
  const parts = [job.location, job.employmentType, job.workModel, job.seniority];
  if (job.datePosted) parts.push(`Posted ${formatDatePosted(job.datePosted)}`);
  return parts.filter(Boolean).join(" · ");
}

// datePosted is stored as UTC day/time (see server/src/automation/jobright.ts
// parsePublishTime) - format in UTC too so every viewer sees the same date
// regardless of their own timezone.
export function formatDatePosted(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

type AppliedFilter = "all" | "applied";
type SourceFilter = "all" | "external" | "admin" | "recommended";

export function Dashboard() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [addedByFilter, setAddedByFilter] = useState("all");
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  const { watch } = usePollTask((task) => {
    loadJobs();
    if (task.status === "failed") {
      show(`${TASK_LABEL[task.type]} failed: ${task.error || "unknown error"}`, "error");
    } else if (task.type === "run_search") {
      show("Search complete - results added to your job list.", "success");
    } else if (task.type === "add_job") {
      show("Job added and contacts pulled.", "success");
    } else if (task.type === "sync_github_h1b") {
      show("Recommended jobs updated.", "success");
    }
  });

  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [applyFilters, setApplyFilters] = useState(true);
  const [country, setCountry] = useState<string[]>([]);
  const [company, setCompany] = useState("");
  const [seniority, setSeniority] = useState<string[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [workModel, setWorkModel] = useState<string[]>([]);
  const [daysAgo, setDaysAgo] = useState("Past 24 hours");
  const [maxPerRun, setMaxPerRun] = useState(10);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Date filter + calendar view are Pro/Elite only - effectivePlan comes
  // from the existing /billing/me endpoint (same one Billing.tsx uses)
  // rather than duplicating plan info onto the auth user.
  const [effectivePlan, setEffectivePlan] = useState<BillingInfo["effectivePlan"] | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const canUseDatesAndCalendar = effectivePlan === "pro" || effectivePlan === "elite";

  async function loadJobs() {
    const params = new URLSearchParams();
    if (canUseDatesAndCalendar && dateFrom) params.set("from", dateFrom);
    if (canUseDatesAndCalendar && dateTo) params.set("to", dateTo);
    const qs = params.toString();
    const { jobs } = await api.get<{ jobs: Job[] }>(`/jobs${qs ? `?${qs}` : ""}`);
    setJobs(jobs);
  }

  useEffect(() => {
    loadJobs();

    const saved = localStorage.getItem(SEARCH_FILTERS_STORAGE_KEY);
    const savedFilters: Partial<SearchParams> | null = saved ? JSON.parse(saved) : null;
    if (savedFilters) {
      if (savedFilters.searchTerm !== undefined) setSearchTerm(savedFilters.searchTerm);
      if (savedFilters.applyFilters !== undefined) setApplyFilters(savedFilters.applyFilters);
      if (savedFilters.country !== undefined) setCountry(savedFilters.country);
      if (savedFilters.company !== undefined) setCompany(savedFilters.company);
      if (savedFilters.seniority !== undefined) setSeniority(savedFilters.seniority);
      if (savedFilters.jobTypes !== undefined) setJobTypes(savedFilters.jobTypes);
      if (savedFilters.workModel !== undefined) setWorkModel(savedFilters.workModel);
      if (savedFilters.daysAgo !== undefined) setDaysAgo(savedFilters.daysAgo);
      if (savedFilters.maxPerRun !== undefined) setMaxPerRun(savedFilters.maxPerRun);
    }

    api.get<FilterOptions>("/jobs/filter-options").then((opts) => {
      setFilterOptions(opts);
      if (!savedFilters) {
        setSeniority(opts.seniority.slice(1, 3)); // Entry Level, Mid Level - matches proven defaults
        setJobTypes(opts.jobTypes.slice(0, 1)); // Full-time
      }
    });
    api.get<BillingInfo>("/billing/me").then((info) => setEffectivePlan(info.effectivePlan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remembers whatever the user last searched with (term, filters, etc.) so
  // reopening the Search Jobs panel doesn't reset to the hardcoded defaults.
  useEffect(() => {
    const filters: SearchParams = { searchTerm, applyFilters, country, company, seniority, jobTypes, workModel, daysAgo, maxPerRun };
    localStorage.setItem(SEARCH_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [searchTerm, applyFilters, country, company, seniority, jobTypes, workModel, daysAgo, maxPerRun]);

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  async function handleAddJob(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { job, taskId } = await api.post<{ job: Job; taskId: number }>("/jobs", { url });
      setUrl("");
      await loadJobs();
      watch(taskId, "add_job");
      void job;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add job");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearchError(null);
    setSearching(true);
    try {
      const { taskId } = await api.post<{ taskId: number }>("/jobs/search", {
        searchTerm,
        applyFilters,
        country,
        company,
        seniority,
        jobTypes,
        workModel,
        daysAgo,
        maxPerRun,
      });
      watch(taskId, "run_search");
      show("Search started - results will appear below shortly.", "info");
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : "Failed to start search");
    } finally {
      setSearching(false);
    }
  }

  async function handleSyncRecommended() {
    setSyncing(true);
    try {
      const { taskId } = await api.post<{ taskId: number }>("/jobs/recommended/sync");
      watch(taskId, "sync_github_h1b");
      show("Recommended sync started - new jobs will appear below shortly.", "info");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to start sync", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRemove(e: MouseEvent, job: Job) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Remove "${jobDisplayTitle(job)}" from the list?`)) return;
    try {
      await api.delete(`/jobs/${job.id}`);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      show("Job removed.", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to remove job", "error");
    }
  }

  function handleApplyNow(e: MouseEvent, job: Job) {
    e.preventDefault();
    e.stopPropagation();
    window.open(job.applyUrl || job.url, "_blank", "noopener,noreferrer");
  }

  async function handleToggleApplied(e: MouseEvent, job: Job) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { job: updated } = await api.patch<{ job: Job }>(`/jobs/${job.id}/applied`, { applied: !job.applied });
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to update", "error");
    }
  }

  // A plain member's job list only ever contains their own jobs (the API
  // scopes it server-side), so this dropdown only has anything to show when
  // the viewer is an admin or on a Pro/Elite plan.
  const addedByEmails = [...new Set(jobs.map((j) => j.addedBy?.email).filter((e): e is string => !!e))];
  const appliedCount = jobs.filter((j) => j.applied).length;
  // "External" means a job someone pasted in by URL themselves, as distinct
  // from one an admin posted - the two are mutually exclusive categories,
  // not "url-sourced" including admin's own url-pasted jobs too.
  const externalCount = jobs.filter((j) => j.source === "url" && j.addedBy?.role !== "admin").length;
  const adminPostedCount = jobs.filter((j) => j.addedBy?.role === "admin").length;
  // The Recommended tab is capped to the top RECOMMENDED_LIMIT, most-recently-
  // posted first - the sync task can leave more than that in the DB over
  // time (each 24h run only adds newly-appeared jobs, never removes old
  // ones), so the cap is enforced here rather than relying on however many
  // happen to exist.
  const recommendedJobs = [...jobs]
    .filter((j) => j.source === "github_h1b")
    .sort((a, b) => {
      const ad = a.datePosted ? new Date(a.datePosted).getTime() : 0;
      const bd = b.datePosted ? new Date(b.datePosted).getTime() : 0;
      return bd !== ad ? bd - ad : b.id - a.id;
    })
    .slice(0, RECOMMENDED_LIMIT);
  const query = searchQuery.trim().toLowerCase();
  const visibleJobs = (sourceFilter === "recommended" ? recommendedJobs : jobs)
    .filter((j) => addedByFilter === "all" || j.addedBy?.email === addedByFilter)
    .filter((j) => appliedFilter === "all" || j.applied)
    .filter(
      (j) =>
        sourceFilter === "all" ||
        sourceFilter === "recommended" ||
        (sourceFilter === "external" ? j.source === "url" && j.addedBy?.role !== "admin" : j.addedBy?.role === "admin")
    )
    .filter((j) => !query || (j.title || "").toLowerCase().includes(query) || (j.company || "").toLowerCase().includes(query));

  return (
    <div>
      <h1>Jobs</h1>
      <form className="add-job-bar" onSubmit={handleAddJob}>
        <input
          type="url"
          placeholder="Paste a job posting URL here to add it"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "+ Add Job"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      <div className="card search-panel">
        <div className="rule-row-head">
          <h2>Search Jobs</h2>
          <button type="button" className="btn-secondary" onClick={() => setShowSearch((s) => !s)}>
            {showSearch ? "Hide" : "Show"}
          </button>
        </div>
        {showSearch && filterOptions && (
          <form onSubmit={handleSearch}>
            <label>
              Search term
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g. Data Center Technician"
                required
              />
            </label>

            <label className="toggle-row">
              <input type="checkbox" checked={applyFilters} onChange={(e) => setApplyFilters(e.target.checked)} />
              Apply filters (uncheck for an unfiltered search)
            </label>

            {applyFilters && (
              <div className="filters-grid">
                <CheckboxGroup label="Country" options={filterOptions.country} selected={country} onChange={setCountry} />
                <label>
                  Company
                  <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Any company" />
                </label>
                <CheckboxGroup
                  label="Experience level"
                  options={filterOptions.seniority}
                  selected={seniority}
                  onChange={setSeniority}
                />
                <CheckboxGroup label="Job type" options={filterOptions.jobTypes} selected={jobTypes} onChange={setJobTypes} />
                <CheckboxGroup
                  label="Work model"
                  options={filterOptions.workModel}
                  selected={workModel}
                  onChange={setWorkModel}
                />
                <label>
                  Date posted
                  <select value={daysAgo} onChange={(e) => setDaysAgo(e.target.value)}>
                    {filterOptions.daysAgo.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <label>
              Max results
              <input
                type="number"
                min={1}
                max={50}
                value={maxPerRun}
                onChange={(e) => setMaxPerRun(Number(e.target.value))}
              />
            </label>

            {searchError && <div className="error">{searchError}</div>}
            <button type="submit" disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </button>
          </form>
        )}
      </div>

      <div className="job-filters-bar">
        <div className="tabs">
          <button
            type="button"
            className={`tab ${appliedFilter === "all" ? "tab-active" : ""}`}
            onClick={() => setAppliedFilter("all")}
          >
            All jobs ({jobs.length})
          </button>
          <button
            type="button"
            className={`tab ${appliedFilter === "applied" ? "tab-active" : ""}`}
            onClick={() => setAppliedFilter("applied")}
          >
            Applied ({appliedCount})
          </button>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={`tab ${sourceFilter === "all" ? "tab-active" : ""}`}
            onClick={() => setSourceFilter("all")}
          >
            All sources
          </button>
          <button
            type="button"
            className={`tab ${sourceFilter === "external" ? "tab-active" : ""}`}
            onClick={() => setSourceFilter("external")}
          >
            External ({externalCount})
          </button>
          {adminPostedCount > 0 && (
            <button
              type="button"
              className={`tab ${sourceFilter === "admin" ? "tab-active" : ""}`}
              onClick={() => setSourceFilter("admin")}
            >
              Admin posted ({adminPostedCount})
            </button>
          )}
          <button
            type="button"
            className={`tab ${sourceFilter === "recommended" ? "tab-active" : ""}`}
            onClick={() => setSourceFilter("recommended")}
          >
            Recommended ({recommendedJobs.length})
          </button>
        </div>

        {sourceFilter === "recommended" && user?.role === "admin" && (
          <button type="button" className="btn-secondary btn-small" onClick={handleSyncRecommended} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        )}

        <input
          type="search"
          className="job-search-input"
          placeholder="Search title or company..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {addedByEmails.length > 1 && (
          <label className="added-by-filter">
            Added by
            <select value={addedByFilter} onChange={(e) => setAddedByFilter(e.target.value)}>
              <option value="all">All members</option>
              {addedByEmails.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </label>
        )}

        {canUseDatesAndCalendar ? (
          <div className="date-filter-bar">
            <label>
              Posted from
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              to
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${viewMode === "list" ? "tab-active" : ""}`}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={`tab ${viewMode === "calendar" ? "tab-active" : ""}`}
                onClick={() => setViewMode("calendar")}
              >
                Calendar
              </button>
            </div>
          </div>
        ) : (
          effectivePlan === "free" && (
            <p className="muted small">
              <Link to="/billing">Upgrade to Pro</Link> to filter by posted date and use the calendar view.
            </p>
          )
        )}
      </div>

      {viewMode === "calendar" && canUseDatesAndCalendar ? (
        <JobCalendar jobs={visibleJobs} monthCursor={monthCursor} onMonthChange={setMonthCursor} />
      ) : (
      <div className="job-list">
        {visibleJobs.length === 0 && (
          <p className="muted">
            {jobs.length === 0 ? "No jobs added yet - paste a URL or search above to get started." : "No jobs match your filters."}
          </p>
        )}
        {visibleJobs.map((job, i) => (
          <Link
            to={`/jobs/${job.id}`}
            key={job.id}
            className="job-row"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <div className="job-row-main">
              <div className="job-title">{jobDisplayTitle(job)}</div>
              <div className="job-sub muted">
                {job.company || "—"} · added by {job.addedBy?.email}
              </div>
              {jobMetaLine(job) && <div className="job-sub muted small">{jobMetaLine(job)}</div>}
              {job.status === "error" && <div className="error small">{job.errorMessage}</div>}
            </div>
            <div className="job-row-side">
              <StatusChip job={job} />
              {job.applied && <span className="chip chip-applied">Applied</span>}
              {job.status === "ready" && <span className="muted">{job._count?.contacts ?? 0} contact(s)</span>}
              <div className="job-row-actions">
                {job.status === "ready" && (
                  <button type="button" className="btn-secondary btn-small" onClick={(e) => handleApplyNow(e, job)}>
                    Apply Now ↗
                  </button>
                )}
                {job.status === "ready" && (
                  <button type="button" className="btn-secondary btn-small" onClick={(e) => handleToggleApplied(e, job)}>
                    {job.applied ? "Unmark Applied" : "Mark Applied"}
                  </button>
                )}
                {(user?.role === "admin" || job.addedById === user?.id) && (
                  <button type="button" className="btn-secondary btn-small btn-danger" onClick={(e) => handleRemove(e, job)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
