/**
 * sanitize.js — Input sanitization utilities.
 * Ported from StockMind AI's implementation.
 * Prevents XSS, injection attacks, SSRF.
 * All user-supplied strings must pass through these before rendering or API use.
 */

/**
 * Strip HTML tags to prevent XSS when rendering user content.
 */
export function stripHtml(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/<[^>]*>/g, '');
}

/**
 * Validate that a URL belongs to an allowed origin (SSRF prevention).
 */
export function isAllowedOrigin(url, allowedOrigins) {
  try {
    const { origin } = new URL(url);
    return allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}

/**
 * Sanitize a text input — strip HTML + control chars.
 * Safe for display in UI and logging.
 */
export function sanitizeText(raw, maxLen = 2000) {
  if (typeof raw !== 'string') return '';
  return stripHtml(raw)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // remove control chars
    .trim()
    .slice(0, maxLen);
}

/**
 * Validate a path string — prevent path traversal.
 */
export function safePath(raw) {
  if (typeof raw !== 'string') return null;
  if (/\.\.(\/|\\)/.test(raw))       return null;  // path traversal
  if (/[<>:"|?*\x00-\x1F]/.test(raw)) return null; // invalid path chars
  return raw.trim();
}

/**
 * Clamp a probability value to [floor, ceiling].
 * Ensures AI outputs are always within valid range.
 * Never shows 0% or 100% — always acknowledges uncertainty.
 */
export function clampProbability(p, floor = 0.05, ceiling = 0.99) {
  if (typeof p !== 'number' || isNaN(p)) return floor;
  return Math.max(floor, Math.min(ceiling, p));
}

/**
 * Mask sensitive values for logging (show first 4 chars only).
 */
export function maskSecret(value, visibleChars = 4) {
  if (typeof value !== 'string') return '[REDACTED]';
  if (value.length <= visibleChars) return '****';
  return value.slice(0, visibleChars) + '****';
}
