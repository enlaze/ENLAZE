import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type GoogleIntegrationModule =
  | "gmail"
  | "google_calendar"
  | "google_sheets"
  | "google_business"
  | "all";

export interface OAuthStatePayload {
  userId: string;
  module: GoogleIntegrationModule;
  returnTo: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

const VALID_MODULES = new Set<GoogleIntegrationModule>([
  "gmail",
  "google_calendar",
  "google_sheets",
  "google_business",
  "all",
]);

function getSigningSecret() {
  const secret =
    process.env.OAUTH_STATE_SECRET ||
    process.env.OAUTH_ENCRYPTION_KEY ||
    process.env.GOOGLE_CLIENT_SECRET;

  if (!secret || secret.trim().length < 24) {
    throw new Error("OAuth state signing secret is not configured");
  }

  return secret.replace(/^["']|["']$/g, "").trim();
}

function sign(value: string) {
  return createHmac("sha256", getSigningSecret())
    .update(value)
    .digest("base64url");
}

export function createOAuthState(
  input: Pick<OAuthStatePayload, "userId" | "module" | "returnTo">
) {
  if (!VALID_MODULES.has(input.module)) {
    throw new Error("Invalid Google integration module");
  }

  const now = Date.now();
  const payload: OAuthStatePayload = {
    ...input,
    nonce: randomBytes(18).toString("base64url"),
    issuedAt: now,
    expiresAt: now + 10 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOAuthState(value: string): OAuthStatePayload | null {
  const [encoded, receivedSignature, extra] = value.split(".");
  if (!encoded || !receivedSignature || extra) return null;

  const expectedSignature = sign(encoded);
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(receivedSignature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as OAuthStatePayload;

    if (
      !payload.userId ||
      !payload.returnTo ||
      !VALID_MODULES.has(payload.module) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
