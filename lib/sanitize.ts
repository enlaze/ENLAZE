/**
 * Input sanitization utilities to prevent XSS and injection attacks.
 * Server-side sanitization for user-provided content.
 */

/**
 * Escape HTML special characters to prevent XSS when embedding in HTML.
 * Use this for any user input that will be rendered in HTML emails or pages.
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Strip all HTML tags from a string.
 * Use for plain-text contexts where no HTML is expected.
 */
export function stripHtml(str: string): string {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize a string for safe SQL use (basic protection — always use
 * parameterized queries as the primary defense).
 */
export function sanitizeForDb(str: string): string {
  if (!str) return "";
  return str.replace(/['";\\]/g, "");
}

/**
 * Validate and sanitize an email address.
 * Returns the sanitized email or null if invalid.
 */
export function sanitizeEmail(email: string): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  // RFC 5322 simplified pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  if (!emailRegex.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

/**
 * Validate UUID format.
 */
export function isValidUuid(str: string): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Sanitize a generic text field (name, description, etc.).
 * Strips HTML but allows normal punctuation.
 */
export function sanitizeText(str: string, maxLength = 500): string {
  if (!str) return "";
  return stripHtml(str).trim().substring(0, maxLength);
}

/**
 * Sanitize a numeric string. Returns the number or null if invalid.
 */
export function sanitizeNumber(str: string | number): number | null {
  const n = Number(str);
  if (isNaN(n) || !isFinite(n)) return null;
  return n;
}

/**
 * Validate that a string only contains safe characters for filenames.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return "file";
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .substring(0, 255);
}
