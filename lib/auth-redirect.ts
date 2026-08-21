const INTERNAL_ORIGIN = "https://enlaze.local";

export function resolveSafeAuthRedirect(
  search: string,
  fallback = "/dashboard"
): string {
  const requested = new URLSearchParams(search).get("redirect");
  if (!requested) return fallback;

  try {
    const resolved = new URL(requested, INTERNAL_ORIGIN);
    if (resolved.origin !== INTERNAL_ORIGIN) return fallback;

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
