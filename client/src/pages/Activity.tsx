import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";

interface ActivityContact {
  id: number;
  email: string | null;
  name: string | null;
  status: string;
  sentAt: string | null;
  job: { title: string | null; company: string | null };
  sentBy: { email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  dry_run: "Sent (dry run)",
  send_failed: "Failed",
  skipped_disabled: "Sending disabled by sender",
};

export function Activity() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<ActivityContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ contacts: ActivityContact[] }>("/jobs/activity")
      .then((r) => setContacts(r.contacts))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1>Activity</h1>
      <p className="muted">{user?.role === "admin" ? "Recent outreach across the whole team." : "Your recent outreach."}</p>

      {loading && (
        <div className="skeleton-page">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}

      {!loading && contacts.length === 0 && <p className="muted">Nothing sent yet.</p>}

      {!loading && contacts.length > 0 && (
        <div className="card">
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
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.job.title} @ {c.job.company}
                  </td>
                  <td>
                    {c.name} ({c.email})
                  </td>
                  <td>
                    <span className={`chip chip-${c.status}`}>{STATUS_LABEL[c.status] || c.status}</span>
                  </td>
                  <td>{c.sentBy?.email || "—"}</td>
                  <td>{c.sentAt ? new Date(c.sentAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
