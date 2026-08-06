export const MAX_COMPANY_LOGO_BYTES = 2 * 1024 * 1024;
export const COMPANY_LOGO_TIMEOUT_MS = 5_000;

const ALLOWED_LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Accept only the public company-branding object path owned by this user on
 * the configured Supabase origin. The origin comes from server configuration,
 * never from profile data.
 */
export function isAllowedCompanyLogoUrl(
  rawUrl: string,
  supabaseUrl: string,
  userId: string
): boolean {
  try {
    const candidate = new URL(rawUrl);
    const configuredSupabase = new URL(supabaseUrl);
    if (candidate.origin !== configuredSupabase.origin) return false;
    if (candidate.username || candidate.password) return false;

    const decodedPath = decodeURIComponent(candidate.pathname);
    const expectedPrefix = `/storage/v1/object/public/company-branding/${userId}/`;
    if (!decodedPath.startsWith(expectedPrefix)) return false;

    const objectPath = decodedPath.slice(expectedPrefix.length);
    if (!objectPath) return false;
    if (objectPath.split("/").some((segment) => segment === "." || segment === "..")) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error("Logo response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("Company logo exceeds the size limit");
      throw new Error("Company logo exceeds the size limit");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export async function downloadCompanyLogo(options: {
  rawUrl: string;
  supabaseUrl: string;
  userId: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<Buffer | null> {
  const {
    rawUrl,
    supabaseUrl,
    userId,
    fetchImpl = fetch,
    maxBytes = MAX_COMPANY_LOGO_BYTES,
    timeoutMs = COMPANY_LOGO_TIMEOUT_MS,
  } = options;

  if (!isAllowedCompanyLogoUrl(rawUrl, supabaseUrl, userId)) return null;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchImpl(rawUrl, {
      redirect: "manual",
      signal: abortController.signal,
      headers: { Accept: "image/png,image/jpeg,image/webp" },
    });

    if (!response.ok || response.status < 200 || response.status >= 300) {
      return null;
    }

    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_LOGO_CONTENT_TYPES.has(contentType)) return null;

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

    return await readBoundedBody(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}
