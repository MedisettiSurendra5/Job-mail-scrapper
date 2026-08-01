import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api";
import type { BillingInfo, Profile as ProfileType } from "../api";
import { PLAN_CATALOG } from "../api";
import { useToast } from "../Toast";

const OAUTH_RESULT_MESSAGE: Record<string, { text: string; kind: "success" | "error" }> = {
  connected: { text: "Gmail connected.", kind: "success" },
  denied: { text: "Gmail connection was cancelled.", kind: "error" },
  error: { text: "Couldn't connect Gmail - try again.", kind: "error" },
};

export function Profile() {
  const [profile, setProfile] = useState<ProfileType | null>(null);
  const [gmailAddress, setGmailAddress] = useState("");
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [signature, setSignature] = useState("");
  const [sendEnabled, setSendEnabled] = useState(true);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [resumeActionId, setResumeActionId] = useState<number | null>(null);
  const [effectivePlan, setEffectivePlan] = useState<BillingInfo["effectivePlan"]>("free");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const { show } = useToast();

  async function load() {
    const p = await api.get<ProfileType>("/users/me");
    setProfile(p);
    setGmailAddress(p.gmailAddress || "");
    setSignature(p.signature || "");
    setSendEnabled(p.sendEnabled);
  }

  useEffect(() => {
    load();
    api.get<BillingInfo>("/billing/me").then((info) => setEffectivePlan(info.effectivePlan));

    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmail_oauth");
    if (result && OAUTH_RESULT_MESSAGE[result]) {
      const { text, kind } = OAUTH_RESULT_MESSAGE[result];
      show(text, kind);
      window.history.replaceState(null, "", "/profile");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnectGoogle() {
    setDisconnectingGoogle(true);
    try {
      await api.delete("/users/me/gmail-oauth");
      await load();
      show("Gmail disconnected.", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to disconnect", "error");
    } finally {
      setDisconnectingGoogle(false);
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = { gmailAddress, signature, sendEnabled };
      if (gmailAppPassword) payload.gmailAppPassword = gmailAppPassword;
      await api.put("/users/me", payload);
      setGmailAppPassword("");
      await load();
      setMessage("Profile saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadResume(e: FormEvent) {
    e.preventDefault();
    if (!resumeFile) return;
    setError(null);
    setMessage(null);
    setUploadingResume(true);
    const formData = new FormData();
    formData.append("resume", resumeFile);
    try {
      await api.upload("/users/me/resumes", formData);
      setResumeFile(null);
      await load();
      setMessage("Resume uploaded.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to upload resume");
    } finally {
      setUploadingResume(false);
    }
  }

  async function handleSetPrimaryResume(id: number) {
    setResumeActionId(id);
    try {
      await api.put(`/users/me/resumes/${id}/primary`);
      await load();
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to set primary resume", "error");
    } finally {
      setResumeActionId(null);
    }
  }

  async function handleDeleteResume(id: number) {
    setResumeActionId(id);
    try {
      await api.delete(`/users/me/resumes/${id}`);
      await load();
      show("Resume deleted.", "success");
    } catch (e) {
      show(e instanceof ApiError ? e.message : "Failed to delete resume", "error");
    } finally {
      setResumeActionId(null);
    }
  }

  if (!profile) {
    return (
      <div className="skeleton-page">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  return (
    <div>
      <h1>Your Profile</h1>
      <p className="muted">
        Your Gmail address + app password are used to send outreach emails as <em>you</em>, separately from the
        shared job search account used to browse jobs.
      </p>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={handleSaveProfile}>
        <h2>Sending settings</h2>
        <label>
          Gmail address
          <input type="email" value={gmailAddress} onChange={(e) => setGmailAddress(e.target.value)} required />
        </label>
        <label>
          Gmail app password {profile.hasGmailAppPassword && <span className="muted">(already set - leave blank to keep)</span>}
          <input
            type="password"
            value={gmailAppPassword}
            onChange={(e) => setGmailAppPassword(e.target.value)}
            placeholder={profile.hasGmailAppPassword ? "••••••••••••••••" : "16-character app password"}
          />
        </label>
        <label>
          Signature (appended to every outreach email)
          <textarea rows={3} value={signature} onChange={(e) => setSignature(e.target.value)} />
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={sendEnabled} onChange={(e) => setSendEnabled(e.target.checked)} />
          Send real emails when I click Send Resume
        </label>
        {!sendEnabled && (
          <p className="muted small">
            While this is off, your sends are logged but never actually delivered - independent of the admin's dry
            run switch.
          </p>
        )}
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      <div className="card">
        <h2>Connect Gmail (recommended)</h2>
        <p className="muted">
          Connect your Google account instead of pasting an address + app password - no setup on Google's side needed
          from you, and it works even if app passwords are disabled on your account.
        </p>
        {profile.hasGoogleOAuth ? (
          <>
            <p>Connected as {profile.gmailOauthEmail}</p>
            <button type="button" className="btn-secondary" onClick={handleDisconnectGoogle} disabled={disconnectingGoogle}>
              {disconnectingGoogle ? "Disconnecting..." : "Disconnect"}
            </button>
          </>
        ) : profile.oauthConfigured ? (
          <a className="btn-link" href="/api/auth/google/connect">
            Connect Gmail
          </a>
        ) : (
          <>
            {/* Connect is a full-page navigation, not a fetch, so without this
                guard an unconfigured server navigates the whole tab to raw
                501 JSON. */}
            <button type="button" className="btn-link" disabled>
              Connect Gmail
            </button>
            <p className="muted small">
              Google sign-in isn't set up on this server yet - ask your admin to configure it. In the meantime, use
              the Gmail address + app password above.
            </p>
          </>
        )}
      </div>

      <form className="card" onSubmit={handleUploadResume}>
        <h2>Resumes</h2>
        {(() => {
          const maxResumes = PLAN_CATALOG[effectivePlan].maxResumes;
          const atCap = profile.resumes.length >= maxResumes;
          return (
            <>
              <p className="muted">
                {profile.resumes.length} / {maxResumes} used
                {maxResumes === 1 && (
                  <>
                    {" "}
                    - <a href="/billing">upgrade to Pro</a> for up to 5
                  </>
                )}
              </p>
              {profile.resumes.length === 0 && <p className="muted small">No resumes uploaded yet.</p>}
              {profile.resumes.map((r) => (
                <div className="entry-row" key={r.id}>
                  <strong>{r.filename}</strong>
                  {r.isPrimary && <span className="chip chip-sent" style={{ marginLeft: "0.6em" }}>Primary</span>}
                  <div className="contact-body-actions">
                    <a
                      className="btn-secondary btn-small"
                      href={`/api/users/me/resumes/${r.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View
                    </a>
                    {!r.isPrimary && (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        onClick={() => handleSetPrimaryResume(r.id)}
                        disabled={resumeActionId === r.id}
                      >
                        Set primary
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary btn-small btn-danger"
                      onClick={() => handleDeleteResume(r.id)}
                      disabled={resumeActionId === r.id}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {atCap ? (
                <p className="muted small">
                  {maxResumes === 1
                    ? "Free plan is limited to 1 resume - upgrade to Pro for up to 5, or delete your current one first."
                    : `You've reached the ${maxResumes}-resume limit - delete one first to upload another.`}
                </p>
              ) : (
                <>
                  <input type="file" accept="application/pdf" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} />
                  <button type="submit" disabled={!resumeFile || uploadingResume}>
                    {uploadingResume ? "Uploading..." : "Upload resume"}
                  </button>
                </>
              )}
            </>
          );
        })()}
      </form>
    </div>
  );
}
