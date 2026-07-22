import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import type { Contact, Job } from "../api";
import { usePollTask } from "../useTaskPolling";
import { useToast } from "../Toast";
import { formatDatePosted } from "./Dashboard";

const STATUS_LABEL: Record<Contact["status"], string> = {
  found: "Not sent yet",
  no_email_found: "No email found",
  sent: "Sent",
  dry_run: "Sent (dry run)",
  send_failed: "Send failed",
  skipped_duplicate: "Skipped (already contacted)",
  skipped_disabled: "Sending disabled by sender",
};

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

export function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, { subject: string; body: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  const { watch } = usePollTask((task) => {
    load();
    if (task.type === "send_email") {
      show(task.status === "done" ? "Resume sent." : `Send failed: ${task.error || "unknown error"}`, task.status === "done" ? "success" : "error");
    }
  });

  async function load() {
    const [{ job }, { contacts }] = await Promise.all([
      api.get<{ job: Job }>(`/jobs/${id}`),
      api.get<{ contacts: Contact[] }>(`/jobs/${id}/contacts`),
    ]);
    setJob(job);
    setContacts(contacts);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function edited(c: Contact) {
    return edits[c.id] ?? { subject: c.subject || "", body: c.body || "" };
  }

  function updateEdit(contactId: number, field: "subject" | "body", value: string) {
    setEdits((prev) => ({ ...prev, [contactId]: { ...edited(contacts.find((c) => c.id === contactId)!), [field]: value } }));
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function copyEmail(c: Contact) {
    const e = edited(c);
    const text = e.subject ? `Subject: ${e.subject}\n\n${e.body}` : e.body;
    try {
      await navigator.clipboard.writeText(text);
      show("Email copied to clipboard.", "success");
    } catch {
      show("Couldn't copy - your browser blocked clipboard access.", "error");
    }
  }

  async function sendOne(c: Contact) {
    setError(null);
    try {
      const e = edited(c);
      const { taskId } = await api.post<{ taskId: number }>(`/contacts/${c.id}/send`, e);
      watch(taskId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to queue send");
    }
  }

  async function toggleApplied() {
    if (!job) return;
    try {
      const { job: updated } = await api.patch<{ job: Job }>(`/jobs/${job.id}/applied`, { applied: !job.applied });
      setJob(updated);
      show(updated.applied ? "Marked as applied." : "Unmarked as applied.", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to update", "error");
    }
  }

  async function sendSelected() {
    setError(null);
    try {
      const { results } = await api.post<{ results: { contactId: number; taskId?: number; error?: string }[] }>(
        "/contacts/send-bulk",
        { contactIds: [...selected] }
      );
      results.forEach((r) => r.taskId && watch(r.taskId));
      setSelected(new Set());
      show(`Queued ${results.filter((r) => r.taskId).length} send(s).`, "info");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to queue sends");
    }
  }

  if (!job) {
    return (
      <div className="skeleton-page">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const sendableContacts = contacts.filter((c) => c.email && c.status !== "sent");

  return (
    <div>
      <Link to="/" className="back-link">
        ← Back to jobs
      </Link>
      <div className="job-detail-head">
        <div>
          <h1>{job.title || job.url}</h1>
          <p className="muted">{job.company}</p>
          {[job.location, job.employmentType, job.workModel, job.seniority].filter(Boolean).length > 0 && (
            <p className="muted small">{[job.location, job.employmentType, job.workModel, job.seniority].filter(Boolean).join(" · ")}</p>
          )}
          {job.datePosted && <p className="muted small">Posted {formatDatePosted(job.datePosted)}</p>}
        </div>
        <div className="job-detail-head-actions">
          {job.status === "ready" && (job.applyUrl || job.url) && (
            <a className="apply-now-btn" href={job.applyUrl || job.url} target="_blank" rel="noopener noreferrer">
              Apply Now ↗
            </a>
          )}
          {job.status === "ready" && (
            <button
              type="button"
              className={job.applied ? "btn-secondary btn-small" : "btn-small"}
              onClick={toggleApplied}
            >
              {job.applied ? "✓ Applied" : "Mark as Applied"}
            </button>
          )}
        </div>
      </div>

      {job.status === "pending" && <p>Still adding this job...</p>}
      {job.status === "error" && <div className="error">{job.errorMessage}</div>}
      {error && <div className="error">{error}</div>}

      {job.status === "ready" && contacts.length === 0 && (
        <p className="muted">No Insider Connections were found for this job.</p>
      )}

      {sendableContacts.length > 1 && (
        <div className="bulk-bar">
          <button onClick={sendSelected} disabled={selected.size === 0}>
            Send Resume to {selected.size} selected
          </button>
        </div>
      )}

      <div className="contact-list">
        {contacts.map((c, i) => {
          const canSend = !!c.email && c.status !== "sent";
          const e = edited(c);
          return (
            <div className="contact-card" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} key={c.id}>
              <div className="contact-head">
                {canSend && (
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                )}
                <div>
                  <strong>{c.name || "(unknown name)"}</strong>
                  <div className="muted">{c.title}</div>
                  <div className="contact-email-row muted">
                    {c.email || "no email found"}
                    {c.linkedinUrl && (
                      <a
                        className="linkedin-link"
                        href={c.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View LinkedIn profile"
                      >
                        <LinkedInIcon />
                      </a>
                    )}
                  </div>
                </div>
                <span className={`chip chip-${c.status}`}>{STATUS_LABEL[c.status]}</span>
              </div>

              {c.email && (
                <div className="contact-body">
                  <label>
                    Subject
                    <input
                      value={e.subject}
                      disabled={!canSend}
                      onChange={(ev) => updateEdit(c.id, "subject", ev.target.value)}
                    />
                  </label>
                  <label>
                    Body
                    <textarea
                      rows={8}
                      value={e.body}
                      disabled={!canSend}
                      onChange={(ev) => updateEdit(c.id, "body", ev.target.value)}
                    />
                  </label>
                  <div className="contact-body-actions">
                    {canSend && <button onClick={() => sendOne(c)}>Send Resume</button>}
                    <button type="button" className="btn-secondary" onClick={() => copyEmail(c)}>
                      Copy
                    </button>
                  </div>
                  {c.status === "send_failed" && <div className="error small">{c.errorMessage}</div>}
                  {c.sentBy && <div className="muted small">Sent by {c.sentBy.email}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
