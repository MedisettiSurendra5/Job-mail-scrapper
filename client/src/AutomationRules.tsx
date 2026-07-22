import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "./api";
import type { AutomationRule, FilterOptions } from "./api";
import { CheckboxGroup } from "./CheckboxGroup";

interface TeamMember {
  id: number;
  email: string;
}

const INTERVAL_OPTIONS = [1, 2, 5, 10, 24];

function emptyForm(filterOptions: FilterOptions): Omit<AutomationRule, "id"> {
  return {
    name: "",
    searchTerm: "",
    applyFilters: true,
    country: [],
    company: "",
    seniority: filterOptions.seniority.slice(1, 3),
    jobTypes: filterOptions.jobTypes.slice(0, 1),
    workModel: [],
    daysAgo: "Past 24 hours",
    maxPerRun: 10,
    autoSend: false,
    sendAsUserId: null,
    intervalHours: 2,
    enabled: true,
    lastRunAt: null,
  };
}

export function AutomationRules({ users }: { users: TeamMember[] }) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [form, setForm] = useState<Omit<AutomationRule, "id"> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [{ rules }, opts] = await Promise.all([
      api.get<{ rules: AutomationRule[] }>("/admin/automation-rules"),
      api.get<FilterOptions>("/jobs/filter-options"),
    ]);
    setRules(rules);
    setFilterOptions(opts);
    setForm((f) => f ?? emptyForm(opts));
  }

  useEffect(() => {
    load();
  }, []);

  async function createRule(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setMessage(null);
    try {
      await api.post("/admin/automation-rules", form);
      setMessage("Rule created.");
      setShowForm(false);
      if (filterOptions) setForm(emptyForm(filterOptions));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create rule");
    }
  }

  async function toggleEnabled(rule: AutomationRule) {
    await api.put(`/admin/automation-rules/${rule.id}`, { enabled: !rule.enabled });
    await load();
  }

  async function runNow(rule: AutomationRule) {
    setMessage(null);
    setError(null);
    try {
      await api.post(`/admin/automation-rules/${rule.id}/run-now`);
      setMessage(`Running "${rule.name}" now.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to run rule");
    }
  }

  async function deleteRule(rule: AutomationRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await api.delete(`/admin/automation-rules/${rule.id}`);
    await load();
  }

  if (!filterOptions || !form) return null;

  return (
    <div className="card">
      <div className="rule-row-head">
        <h2>Automation Rules</h2>
        <button type="button" className="btn-secondary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ New Rule"}
        </button>
      </div>
      <p className="muted">
        A saved search that runs on a schedule, pulls Insider Connection contacts, and optionally sends resumes
        automatically - no manual review. The global dry-run switch above still applies to every send this triggers.
      </p>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      {showForm && (
        <form onSubmit={createRule}>
          <label>
            Rule name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Search term
            <input
              value={form.searchTerm}
              onChange={(e) => setForm({ ...form, searchTerm: e.target.value })}
              required
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={form.applyFilters}
              onChange={(e) => setForm({ ...form, applyFilters: e.target.checked })}
            />
            Apply filters (unchecked = unfiltered search)
          </label>
          {form.applyFilters && (
            <div className="filters-grid">
              <CheckboxGroup
                label="Country"
                options={filterOptions.country}
                selected={form.country}
                onChange={(v) => setForm({ ...form, country: v })}
              />
              <label>
                Company
                <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </label>
              <CheckboxGroup
                label="Experience level"
                options={filterOptions.seniority}
                selected={form.seniority}
                onChange={(v) => setForm({ ...form, seniority: v })}
              />
              <CheckboxGroup
                label="Job type"
                options={filterOptions.jobTypes}
                selected={form.jobTypes}
                onChange={(v) => setForm({ ...form, jobTypes: v })}
              />
              <CheckboxGroup
                label="Work model"
                options={filterOptions.workModel}
                selected={form.workModel}
                onChange={(v) => setForm({ ...form, workModel: v })}
              />
              <label>
                Date posted
                <select value={form.daysAgo} onChange={(e) => setForm({ ...form, daysAgo: e.target.value })}>
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
            Max jobs per run
            <input
              type="number"
              min={1}
              max={50}
              value={form.maxPerRun}
              onChange={(e) => setForm({ ...form, maxPerRun: Number(e.target.value) })}
            />
          </label>
          <label>
            Run every
            <select
              value={form.intervalHours}
              onChange={(e) => setForm({ ...form, intervalHours: Number(e.target.value) })}
            >
              {INTERVAL_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h} hour{h === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={form.autoSend}
              onChange={(e) => setForm({ ...form, autoSend: e.target.checked })}
            />
            Auto-send resumes (no manual review) - respects global dry-run
          </label>
          {form.autoSend && (
            <label>
              Send as
              <select
                value={form.sendAsUserId ?? ""}
                onChange={(e) => setForm({ ...form, sendAsUserId: e.target.value ? Number(e.target.value) : null })}
                required
              >
                <option value="" disabled>
                  Select a team member
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit">Create rule</button>
        </form>
      )}

      {rules.map((rule) => (
        <div className="rule-row" key={rule.id}>
          <div className="rule-row-head">
            <div>
              <strong>{rule.name}</strong>
              <div className="muted small">
                "{rule.searchTerm}" · every {rule.intervalHours}h · max {rule.maxPerRun}/run
                {rule.autoSend ? ` · auto-sends as ${rule.sendAsEmail || "?"}` : " · review-first (no auto-send)"}
              </div>
              <div className="muted small">
                {rule.lastRunAt ? `Last ran ${new Date(rule.lastRunAt).toLocaleString()}` : "Never run yet"}
              </div>
            </div>
            <div className="rule-actions">
              <label className="toggle-row">
                <input type="checkbox" checked={rule.enabled} onChange={() => toggleEnabled(rule)} />
                Enabled
              </label>
              <button type="button" className="btn-secondary" onClick={() => runNow(rule)}>
                Run now
              </button>
              <button type="button" className="btn-secondary btn-danger" onClick={() => deleteRule(rule)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
      {rules.length === 0 && <p className="muted">No automation rules yet.</p>}
    </div>
  );
}
