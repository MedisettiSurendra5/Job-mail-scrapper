import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api";
import type { BulkUploadResult, PlanId, PromoCode } from "../api";
import { PLAN_CATALOG } from "../api";
import { AutomationRules } from "../AutomationRules";

interface AdminUser {
  id: number;
  email: string;
  role: "admin" | "member";
  gmailAddress: string | null;
  resumeFilename: string | null;
  plan: PlanId;
  planExpiresAt: string | null;
  createdAt: string;
}

interface ActivityContact {
  id: number;
  email: string | null;
  name: string | null;
  status: string;
  sentAt: string | null;
  job: { title: string | null; company: string | null };
  sentBy: { email: string } | null;
}

export function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<ActivityContact[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [jrEmail, setJrEmail] = useState("");
  const [jrConfigured, setJrConfigured] = useState(false);
  const [jrPassword, setJrPassword] = useState("");
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "member" as "member" | "admin" });
  const [newPromo, setNewPromo] = useState({ code: "", planTarget: "pro" as PlanId, durationDays: 30 });
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkUploadResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [{ users }, settings, jr, { contacts }, { promoCodes }] = await Promise.all([
      api.get<{ users: AdminUser[] }>("/admin/users"),
      api.get<{ dryRun: boolean }>("/admin/settings"),
      api.get<{ email: string | null; configured: boolean }>("/admin/jobright-config"),
      api.get<{ contacts: ActivityContact[] }>("/admin/activity"),
      api.get<{ promoCodes: PromoCode[] }>("/admin/promo-codes"),
    ]);
    setUsers(users);
    setDryRun(settings.dryRun);
    setJrEmail(jr.email || "");
    setJrConfigured(jr.configured);
    setActivity(contacts);
    setPromoCodes(promoCodes);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleDryRun() {
    const next = !dryRun;
    await api.put("/admin/settings", { dryRun: next });
    setDryRun(next);
  }

  async function saveJobRightConfig(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.put("/admin/jobright-config", { email: jrEmail, password: jrPassword });
      setJrPassword("");
      setMessage("Job search account saved.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save");
    }
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post("/admin/users", newUser);
      setNewUser({ email: "", password: "", role: "member" });
      setMessage("User created.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create user");
    }
  }

  async function handleBulkUpload(e: FormEvent) {
    e.preventDefault();
    if (!bulkFile) return;
    setError(null);
    setMessage(null);
    setBulkResult(null);
    setBulkUploading(true);
    const formData = new FormData();
    formData.append("file", bulkFile);
    try {
      const result = await api.upload<BulkUploadResult>("/admin/jobs/bulk-upload", formData);
      setBulkResult(result);
      setBulkFile(null);
      setMessage(`Queued ${result.queued} job(s) - they'll be added one by one.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBulkUploading(false);
    }
  }

  async function setUserPlan(user: AdminUser, plan: PlanId) {
    const planExpiresAt = plan === "free" ? null : new Date(Date.now() + 30 * 86_400_000).toISOString();
    await api.patch(`/admin/users/${user.id}`, { plan, planExpiresAt });
    await load();
  }

  async function extendUserPlan(user: AdminUser) {
    const base = user.planExpiresAt && new Date(user.planExpiresAt) > new Date() ? new Date(user.planExpiresAt) : new Date();
    const planExpiresAt = new Date(base.getTime() + 30 * 86_400_000).toISOString();
    await api.patch(`/admin/users/${user.id}`, { planExpiresAt });
    await load();
  }

  async function createPromoCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post("/admin/promo-codes", newPromo);
      setNewPromo({ code: "", planTarget: "pro", durationDays: 30 });
      setMessage("Promo code created.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create promo code");
    }
  }

  async function deletePromoCode(id: number) {
    if (!confirm("Delete this promo code?")) return;
    await api.delete(`/admin/promo-codes/${id}`);
    await load();
  }

  return (
    <div>
      <h1>Admin</h1>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>Safety switch</h2>
        <label className="toggle-row">
          <input type="checkbox" checked={dryRun} onChange={toggleDryRun} />
          Dry run (scrape + log, don't actually send emails)
        </label>
      </div>

      <form className="card" onSubmit={saveJobRightConfig}>
        <h2>Shared job search account</h2>
        <p className="muted">{jrConfigured ? "Currently configured." : "Not configured yet."}</p>
        <label>
          Login email
          <input type="email" value={jrEmail} onChange={(e) => setJrEmail(e.target.value)} required />
        </label>
        <label>
          Login password
          <input
            type="password"
            value={jrPassword}
            onChange={(e) => setJrPassword(e.target.value)}
            placeholder={jrConfigured ? "leave blank to keep current" : "required"}
            required={!jrConfigured}
          />
        </label>
        <button type="submit">Save</button>
      </form>

      <form className="card" onSubmit={createUser}>
        <h2>Add a team member</h2>
        <label>
          Email
          <input
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            required
          />
        </label>
        <label>
          Temporary password
          <input
            type="text"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            minLength={8}
            required
          />
        </label>
        <label>
          Role
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit">Create user</button>
      </form>

      <form className="card" onSubmit={handleBulkUpload}>
        <h2>Bulk add jobs</h2>
        <p className="muted">
          Upload an .xlsx or .csv file with one job posting URL per row (an optional "URL" header is fine). Each job is
          added and its contacts pulled one at a time, same as adding a single job by URL.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
        />
        <button type="submit" disabled={!bulkFile || bulkUploading}>
          {bulkUploading ? "Uploading..." : "Upload"}
        </button>
        {bulkResult && bulkResult.skipped.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Reason skipped</th>
              </tr>
            </thead>
            <tbody>
              {bulkResult.skipped.map((s) => (
                <tr key={s.row}>
                  <td>{s.row}</td>
                  <td>{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>

      <AutomationRules users={users} />

      <form className="card" onSubmit={createPromoCode}>
        <h2>Promo codes</h2>
        <label>
          Code
          <input
            type="text"
            value={newPromo.code}
            onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
            placeholder="e.g. WELCOME30"
            required
          />
        </label>
        <label>
          Grants plan
          <select
            value={newPromo.planTarget}
            onChange={(e) => setNewPromo({ ...newPromo, planTarget: e.target.value as PlanId })}
          >
            <option value="pro">Pro</option>
            <option value="elite">Elite</option>
          </select>
        </label>
        <label>
          Duration (days)
          <input
            type="number"
            min={1}
            max={365}
            value={newPromo.durationDays}
            onChange={(e) => setNewPromo({ ...newPromo, durationDays: Number(e.target.value) })}
          />
        </label>
        <button type="submit">Create promo code</button>

        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Plan</th>
              <th>Duration</th>
              <th>Redeemed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promoCodes.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{PLAN_CATALOG[p.planTarget].name}</td>
                <td>{p.durationDays} days</td>
                <td>
                  {p.redeemedCount}
                  {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}
                </td>
                <td>
                  <button type="button" className="btn-secondary btn-small btn-danger" onClick={() => deletePromoCode(p.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>

      <div className="card">
        <h2>Team</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Gmail</th>
              <th>Resume</th>
              <th>Plan</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.gmailAddress || "—"}</td>
                <td>{u.resumeFilename || "—"}</td>
                <td>
                  <select value={u.plan} onChange={(e) => setUserPlan(u, e.target.value as PlanId)}>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="elite">Elite</option>
                  </select>
                </td>
                <td>{u.planExpiresAt ? new Date(u.planExpiresAt).toLocaleDateString() : "—"}</td>
                <td>
                  {u.plan !== "free" && (
                    <button type="button" className="btn-secondary btn-small" onClick={() => extendUserPlan(u)}>
                      +30 days
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Activity log</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Contact</th>
              <th>Status</th>
              <th>Sent by</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {activity.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.job.title} @ {c.job.company}
                </td>
                <td>
                  {c.name} ({c.email})
                </td>
                <td>{c.status}</td>
                <td>{c.sentBy?.email || "—"}</td>
                <td>{c.sentAt ? new Date(c.sentAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
