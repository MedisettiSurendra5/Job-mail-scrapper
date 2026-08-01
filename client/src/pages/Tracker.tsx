import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { ApplicationStatus, BillingInfo, Profile as ProfileType, Task, TrackedApplication } from "../api";
import { usePollTask } from "../useTaskPolling";
import { useToast } from "../Toast";

const STATUS_SECTIONS: { status: ApplicationStatus; label: string }[] = [
  { status: "applied", label: "Applied" },
  { status: "screening", label: "Screening" },
  { status: "phone_interview", label: "Phone Interview" },
  { status: "upcoming_interview", label: "Upcoming Interview" },
  { status: "rejected", label: "Rejected" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Tracker() {
  const [effectivePlan, setEffectivePlan] = useState<BillingInfo["effectivePlan"] | null>(null);
  const [hasGoogleOAuth, setHasGoogleOAuth] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [applications, setApplications] = useState<TrackedApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { show } = useToast();

  const { watch } = usePollTask((task: Task) => {
    setSyncing(false);
    if (task.status === "failed") {
      show(`Sync failed: ${task.error || "unknown error"}`, "error");
    } else {
      show("Applications synced.", "success");
    }
    load();
  });

  async function load() {
    const [billing, profile, tracker] = await Promise.all([
      api.get<BillingInfo>("/billing/me"),
      api.get<ProfileType>("/users/me"),
      api.get<{ enabled: boolean; lastSyncAt: string | null; applications: TrackedApplication[] }>("/tracker"),
    ]);
    setEffectivePlan(billing.effectivePlan);
    setHasGoogleOAuth(profile.hasGoogleOAuth);
    setEnabled(tracker.enabled);
    setLastSyncAt(tracker.lastSyncAt);
    setApplications(tracker.applications);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggle() {
    setToggling(true);
    try {
      const result = await api.put<{ enabled: boolean }>("/tracker/enable", { enabled: !enabled });
      if (result.enabled) show("Application Tracker enabled - first sync starting now.", "success");
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to update", "error");
    } finally {
      setToggling(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    try {
      const { taskId } = await api.post<{ taskId: number }>("/tracker/sync");
      watch(taskId, "sync_application_tracker");
    } catch (e) {
      setSyncing(false);
      show(e instanceof ApiError ? e.message : "Failed to start sync", "error");
    }
  }

  if (loading || !effectivePlan) {
    return (
      <div className="skeleton-page">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  if (effectivePlan === "free") {
    return (
      <div>
        <h1>Application Tracker</h1>
        <div className="card">
          <h2>Pro & Elite feature</h2>
          <p className="muted">
            Automatically read your inbox and track every application's status - applied, screening, phone
            interview, upcoming interview, or rejected - with no manual updating.{" "}
            <a href="/billing">Upgrade to Pro</a> to turn it on.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Application Tracker</h1>
      <p className="muted">
        Automatically reads your connected Gmail inbox and keeps this list in sync - up to the 50 most recent
        applications, newest first.
      </p>

      <div className="card">
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={handleToggle} disabled={toggling || !hasGoogleOAuth} />
          Enable Application Tracker
        </label>
        {!hasGoogleOAuth && (
          <p className="muted small">
            <a href="/profile">Connect Gmail</a> from your Profile page first - this feature only works with the
            OAuth connection, not the manual app-password option.
          </p>
        )}
        {enabled && (
          <>
            <p className="muted small">{lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString()}` : "Not synced yet."}</p>
            <button type="button" className="btn-secondary btn-small" onClick={handleSyncNow} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </button>
          </>
        )}
      </div>

      {enabled && (
        <div className="tracker-columns">
          {STATUS_SECTIONS.map(({ status, label }) => {
            const rows = applications.filter((a) => a.status === status);
            return (
              <div className="card" key={status}>
                <h2>
                  {label} <span className="muted small">({rows.length})</span>
                </h2>
                {rows.length === 0 && <p className="muted small">Nothing here yet.</p>}
                {rows.map((a) => (
                  <div className="entry-row" key={a.id}>
                    <strong>{a.company}</strong>
                    {a.roleTitle && <div className="muted small">{a.roleTitle}</div>}
                    <div className="muted small">{formatDate(a.lastEmailAt)}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
