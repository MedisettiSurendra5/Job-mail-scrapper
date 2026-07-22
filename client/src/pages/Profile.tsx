import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api";
import type { Profile as ProfileType } from "../api";
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
    const formData = new FormData();
    formData.append("resume", resumeFile);
    try {
      await api.upload("/users/me/resume", formData);
      setResumeFile(null);
      await load();
      setMessage("Resume uploaded.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to upload resume");
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
        ) : (
          <a className="btn-link" href="/api/auth/google/connect">
            Connect Gmail
          </a>
        )}
      </div>

      <form className="card" onSubmit={handleUploadResume}>
        <h2>Resume</h2>
        <p className="muted">Current: {profile.resumeFilename || "none uploaded yet"}</p>
        <input type="file" accept="application/pdf" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} />
        <button type="submit" disabled={!resumeFile}>
          Upload resume
        </button>
      </form>
    </div>
  );
}
