import { createClient } from "@supabase/supabase-js";
import { encryptToken, decryptToken } from "@/lib/crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.replace(/^["']|["']$/g, '').trim() : undefined;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.replace(/^["']|["']$/g, '').trim() : undefined;

export interface GoogleCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string;
}

/**
 * Gets a valid Google access token for a user and module.
 * Refreshes the token automatically if it has expired.
 */
export async function getValidAccessToken(
  supabase: any,
  userId: string,
  module: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_connections")
    .select("id, credentials_ref")
    .eq("user_id", userId)
    .eq("module", module)
    .maybeSingle();

  if (error || !data || !data.credentials_ref) {
    return null;
  }

  let creds: GoogleCredentials;
  try {
    const rawData = typeof data.credentials_ref === 'string' 
      ? JSON.parse(data.credentials_ref) 
      : data.credentials_ref;
    
    creds = {
      access_token: decryptToken(rawData.access_token),
      refresh_token: rawData.refresh_token ? decryptToken(rawData.refresh_token) : "",
      expires_at: rawData.expires_at,
      email: rawData.email
    };
  } catch (err) {
    console.error("[GoogleAPI] Error parsing/decrypting credentials:", err);
    return null;
  }

  // Check expiration (add a 1-minute buffer)
  const expiresAtDate = new Date(creds.expires_at);
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);

  if (expiresAtDate <= now) {
    console.log(`[GoogleAPI] Token expired for user ${userId} / module ${module}. Refreshing...`);
    
    if (!creds.refresh_token) {
      console.error("[GoogleAPI] No refresh token available to refresh access token.");
      return null;
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("[GoogleAPI] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in env");
      return null;
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
        console.error("[GoogleAPI] Failed to refresh token:", tokenData);
        // If refresh fails due to revoked grant, we should mark as disconnected
        if (tokenData.error === "invalid_grant") {
          await supabase
            .from("agent_connections")
            .update({ connected: false, status: "error", error_message: "Token revoked or expired." })
            .eq("id", data.id);
        }
        return null;
      }

      // Update in DB
      const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      const updatedCredsObj = {
        access_token: encryptToken(tokenData.access_token),
        refresh_token: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : encryptToken(creds.refresh_token),
        expires_at: newExpiresAt,
        email: creds.email
      };

      await supabase
        .from("agent_connections")
        .update({
          credentials_ref: JSON.stringify(updatedCredsObj),
          updated_at: new Date().toISOString()
        })
        .eq("id", data.id);

      console.log(`[GoogleAPI] Token refreshed successfully for ${module}.`);
      return tokenData.access_token;
    } catch (refreshErr) {
      console.error("[GoogleAPI] Error doing refresh fetch:", refreshErr);
      return null;
    }
  }

  return creds.access_token;
}
