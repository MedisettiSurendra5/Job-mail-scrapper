import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import type { BillingInfo, FilterOptions, Job, Task } from "../api";
import { usePollTask } from "../useTaskPolling";
import { CheckboxGroup } from "../CheckboxGroup";
import { JobCalendar } from "../JobCalendar";
import { useToast } from "../Toast";

const TASK_LABEL: Record<Task["type"], string> = {
  add_job: "Adding job",
  pull_emails: "Pulling contacts",
  send_email: "Sending resume",
  run_search: "Search",
};

function StatusChip({ job }: { job: Job }) {
  const label = { pending: "Adding...", ready: "Ready", error: "Error" }[job.status];
  return <span className={`chip chip-${job.status}`}>{label}</span>;
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

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [addedByFilter, setAddedByFilter] = useState("all");
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>("all");
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
    api.get<FilterOptions>("/jobs/filter-options").then((opts) => {
      setFilterOptions(opts);
      setSeniority(opts.seniority.slice(1, 3)); // Entry Level, Mid Level - matches proven defaults
      setJobTypes(opts.jobTypes.slice(0, 1)); // Full-time
    });
    api.get<BillingInfo>("/billing/me").then((info) => setEffectivePlan(info.effectivePlan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      watch(taskId);
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
      watch(taskId);
      show("Search started - results will appear below shortly.", "info");
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : "Failed to start search");
    } finally {
      setSearching(false);
    }
  }

  async function handleRemove(e: MouseEvent, job: Job) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Remove "${job.title || job.url}" from the list?`)) return;
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
  const visibleJobs = jobs
    .filter((j) => addedByFilter === "all" || j.addedBy?.email === addedByFilter)
    .filter((j) => appliedFilter === "all" || j.applied);

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
        {visibleJobs.length === 0 && <p className="muted">No jobs added yet - paste a URL or search above to get started.</p>}
        {visibleJobs.map((job, i) => (
          <Link
            to={`/jobs/${job.id}`}
            key={job.id}
            className="job-row"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <div className="job-row-main">
              <div className="job-title">{job.title || job.url}</div>
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
                <button type="button" className="btn-secondary btn-small btn-danger" onClick={(e) => handleRemove(e, job)}>
                  Remove
                </button>
              </div>
            </div>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
