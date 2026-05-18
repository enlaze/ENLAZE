import { encryptToken, safeDecryptToken } from "@/lib/crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.replace(/^["']|["']$/g, '').trim() : undefined;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.replace(/^["']|["']$/g, '').trim() : undefined;

export interface GoogleCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string;
}

/**
 * Result status for {@link getAccessTokenInfo}. Maps roughly onto the human
 * states that surface in the agent inspector.
 *
 * - `active`           → token decrypted and (if needed) refreshed successfully
 * - `not_connected`    → no row in agent_connections, or `connected=false`
 * - `no_credentials`   → row exists but `credentials_ref` is empty/null
 * - `decrypt_failed`   → ciphertext present but OAUTH_ENCRYPTION_KEY can't open it
 * - `no_refresh_token` → access token expired and no refresh token stored
 * - `refresh_failed`   → Google rejected the refresh (revoked, invalid_grant, etc.)
 * - `config_error`     → missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in env
 */
export type AccessTokenStatus =
  | "active"
  | "not_connected"
  | "no_credentials"
  | "decrypt_failed"
  | "no_refresh_token"
  | "refresh_failed"
  | "config_error";

export interface AccessTokenInfo {
  token: string | null;
  status: AccessTokenStatus;
  error_message: string | null;
  email?: string | null;
}

/**
 * Detailed version of {@link getValidAccessToken}: returns the access token
 * AND a status describing why it's missing when it is. Summary endpoints use
 * this to render `{ connected: false, status: 'decrypt_failed', ... }` instead
 * of dying with a 500.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAccessTokenInfo(
  supabase: any,
  userId: string,
  module: string,
): Promise<AccessTokenInfo> {
  const { data, error } = await supabase
    .from("agent_connections")
    .select("id, connected, credentials_ref")
    .eq("user_id", userId)
    .eq("module", module)
    .maybeSingle();

  if (error) {
    return { token: null, status: "config_error", error_message: `agent_connections lookup failed: ${error.message}` };
  }
  if (!data) {
    return { token: null, status: "not_connected", error_message: "No connection row in agent_connections" };
  }
  if (data.connected === false) {
    return { token: null, status: "not_connected", error_message: "agent_connections.connected = false" };
  }
  if (!data.credentials_ref) {
    return { token: null, status: "no_credentials", error_message: "credentials_ref is empty" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawData: any;
  try {
    rawData = typeof data.credentials_ref === "string"
      ? JSON.parse(data.credentials_ref)
      : data.credentials_ref;
  } catch (err) {
    return {
      token: null,
      status: "no_credentials",
      error_message: `Could not parse credentials_ref JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const accessDecrypt = safeDecryptToken(rawData.access_token);
  if (!accessDecrypt.ok) {
    return {
      token: null,
      status: "decrypt_failed",
      error_message: `Could not decrypt access_token (${accessDecrypt.reason}). Likely OAUTH_ENCRYPTION_KEY mismatch between environments. Reconnect from this environment to fix.`,
      email: rawData.email || null,
    };
  }

  const refreshDecrypt = rawData.refresh_token
    ? safeDecryptToken(rawData.refresh_token)
    : ({ ok: false, reason: "missing", error: "no refresh token stored" } as const);

  const creds: GoogleCredentials = {
    access_token: accessDecrypt.plaintext,
    refresh_token: refreshDecrypt.ok ? refreshDecrypt.plaintext : "",
    expires_at: rawData.expires_at,
    email: rawData.email,
  };

  const expiresAtDate = new Date(creds.expires_at);
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);

  if (expiresAtDate > now) {
    return { token: creds.access_token, status: "active", error_message: null, email: creds.email };
  }

  // ── token expired: refresh ─────────────────────────────────────────────
  if (!creds.refresh_token) {
    return {
      token: null,
      status: "no_refresh_token",
      error_message: "Access token expired and no refresh token is available. User must reconnect.",
      email: creds.email,
    };
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return {
      token: null,
      status: "config_error",
      error_message: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in env",
      email: creds.email,
    };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: creds.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await response.json();
    if (!response.ok) {
      if (tokenData.error === "invalid_grant") {
        await supabase
          .from("agent_connections")
          .update({ connected: false, status: "error", error_message: "Token revoked or expired." })
          .eq("id", data.id);
      }
      return {
        token: null,
        status: "refresh_failed",
        error_message: `Google refresh rejected: ${tokenData.error || response.statusText} ${tokenData.error_description || ""}`.trim(),
        email: creds.email,
      };
    }

    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const updatedCredsObj = {
      access_token: encryptToken(tokenData.access_token),
      refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : encryptToken(creds.refresh_token),
      expires_at: newExpiresAt,
      email: creds.email,
    };

    await supabase
      .from("agent_connections")
      .update({
        credentials_ref: JSON.stringify(updatedCredsObj),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return { token: tokenData.access_token, status: "active", error_message: null, email: creds.email };
  } catch (refreshErr) {
    return {
      token: null,
      status: "refresh_failed",
      error_message: `Network or unexpected error during token refresh: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`,
      email: creds.email,
    };
  }
}

/**
 * Gets a valid Google access token for a user and module.
 * Refreshes the token automatically if it has expired.
 *
 * Thin wrapper over {@link getAccessTokenInfo} for callers that only need the
 * token string and don't care about the failure reason. Action endpoints
 * (sending email, creating events) live with the existing null-or-token shape.
 * New code that needs to render a status to the user should call
 * {@link getAccessTokenInfo} directly.
 */
export async function getValidAccessToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  module: string,
): Promise<string | null> {
  const info = await getAccessTokenInfo(supabase, userId, module);
  if (info.status !== "active") {
    console.log(`[GoogleAPI] Token unavailable for user ${userId} / module ${module}: ${info.status} — ${info.error_message}`);
  }
  return info.token;
}
