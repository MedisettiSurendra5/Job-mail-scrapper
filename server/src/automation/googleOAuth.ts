import type { Request } from "express";
import { env } from "../env";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

export function isGoogleOAuthConfigured(): boolean {
  return !!(env.googleClientId && env.googleClientSecret);
}

// Derived from the request rather than configured, so the callback URL is
// automatically correct on every origin the app is reachable at, and a stale
// GOOGLE_REDIRECT_URI can't silently produce redirect_uri_mismatch. Requires
// `trust proxy` (set in index.ts) for req.protocol to report the browser's
// scheme rather than the plaintext hop from the tunnel/reverse proxy.
export function resolveGoogleRedirectUri(req: Request): string {
  if (env.googleRedirectUri) return env.googleRedirectUri;
  return `${req.protocol}://${req.get("host")}${GOOGLE_CALLBACK_PATH}`;
}

// `redirectUri` is passed in rather than read from env because Google
// requires the value used to build the consent URL and the one sent with the
// code exchange to match byte for byte - see resolveGoogleRedirectUri in
// routes/auth.ts, which derives both from the same request.
export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Forces Google to return a refresh_token even on repeat consent - it's
    // otherwise only sent the very first time an account grants access.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokens {
  refresh_token?: string;
  access_token: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as GoogleTokens & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(json.error_description || json.error || "Google token exchange failed");
  return json;
}

// Google answers `invalid_grant` when the stored refresh token is dead for
// good - the user revoked access, or the consent screen is still in "Testing"
// and the 7-day expiry elapsed. Retrying can never help, so callers should
// clear the token and put the member back in the "not connected" state rather
// than failing every sync forever behind a UI that claims Gmail is connected.
export class GoogleRefreshTokenRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleRefreshTokenRevokedError";
  }
}

// Exchanges a stored refresh token for a short-lived access token - used to
// call the Gmail API directly (see automation/emailTracker.ts) rather than
// through nodemailer, which only ever needs the refresh token itself.
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (json.error === "invalid_grant") {
    throw new GoogleRefreshTokenRevokedError(
      "Your Google connection is no longer valid - reconnect Gmail from your Profile page."
    );
  }
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Failed to refresh Google access token");
  }
  return { access_token: json.access_token };
}

// Scope includes openid+email, so the id_token JWT already carries the
// granted account's email in its payload - decode it locally rather than
// making an extra userinfo call.
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return payload.email || null;
  } catch {
    return null;
  }
}
