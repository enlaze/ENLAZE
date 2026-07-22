/**
 * In-memory rate limiter for API routes.
 *
 * On Vercel serverless, each cold start gets its own Map, so this is
 * best-effort — but still catches rapid-fire abuse from the same IP
 * within a single instance lifetime (typically minutes).
 *
 * For production-grade limiting, consider Vercel KV or Upstash Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically to prevent memory leaks
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request is within rate limits.
 *
 * @param identifier - Unique key (typically IP or userId)
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const key = identifier;
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    const resetAt = now + config.windowSeconds * 1000;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  // Existing window
  entry.count++;
  const remaining = Math.max(0, config.limit - entry.count);

  if (entry.count > config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining, resetAt: entry.resetAt };
}

/**
 * Get IP address from request headers (handles proxies).
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/* ── Pre-configured limiters for common use cases ── */

/** Standard API: 60 requests per minute */
export function rateLimitStandard(request: Request) {
  return checkRateLimit(`std:${getClientIp(request)}`, {
    limit: 60,
    windowSeconds: 60,
  });
}

/** Sensitive APIs (email, OTP): 10 requests per minute */
export function rateLimitSensitive(request: Request) {
  return checkRateLimit(`sensitive:${getClientIp(request)}`, {
    limit: 10,
    windowSeconds: 60,
  });
}

/** Auth APIs: 5 requests per minute */
export function rateLimitAuth(request: Request) {
  return checkRateLimit(`auth:${getClientIp(request)}`, {
    limit: 5,
    windowSeconds: 60,
  });
}
