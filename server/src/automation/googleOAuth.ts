import { env } from "../env";

const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.googleClientId!,
    redirect_uri: env.googleRedirectUri!,
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

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      redirect_uri: env.googleRedirectUri!,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as GoogleTokens & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(json.error_description || json.error || "Google token exchange failed");
  return json;
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
