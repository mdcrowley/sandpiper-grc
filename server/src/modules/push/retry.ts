// Retrying pushes that failed for a while only (E38-14): the service was unreachable or too slow, it
// answered 5xx, or it asked the server to slow down (429, honoring Retry-After). A rejection that will
// not change by waiting (a token the service no longer knows, wrong credentials, a bad request) is never
// retried. Each registration keeps its own series of attempts (push_registrations.retry_at,
// retry_attempts); see deliver.ts for how a retry is claimed so it is sent once.

/** Waits before each retry of a series, in seconds: 30 s, 2 min, 10 min, 30 min, 1 h (then give up). */
export const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600] as const;
export const MAX_RETRIES = RETRY_DELAYS_SECONDS.length;
/** A service asking to wait longer than this is not waited for: a push is about now, not tomorrow. */
export const MAX_RETRY_AFTER_SECONDS = 6 * 3600;
/** Never sooner than this, even when the service says "0". */
export const MIN_RETRY_SECONDS = 5;

/**
 * An HTTP `Retry-After` value in seconds from now (delta-seconds or an HTTP date), or null when there
 * is none or it cannot be read.
 */
export function parseRetryAfter(value: unknown, now = Date.now()): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const text = String(v).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  // An HTTP date names the day and month ("Sun, 22 Nov 2026 10:00:00 GMT"); a bare "-5" or "1.5" is not one.
  if (!/[A-Za-z]{3}/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/**
 * How long to wait before retry number `attempt` (1 for the first retry), or null to give up: after
 * MAX_RETRIES, or when the service asked for a wait longer than MAX_RETRY_AFTER_SECONDS. A wait the
 * service asked for is honored as given (never shorter); otherwise the next step of the back-off.
 */
export function retryDelaySeconds(attempt: number, retryAfterSeconds?: number | null): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES) return null;
  if (retryAfterSeconds !== undefined && retryAfterSeconds !== null) {
    if (retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) return null;
    return Math.max(MIN_RETRY_SECONDS, Math.ceil(retryAfterSeconds));
  }
  return RETRY_DELAYS_SECONDS[attempt - 1];
}

/** HTTP statuses that mean "try again later": 429 and 5xx (but not 501 Not Implemented or 505). */
export const temporaryStatus = (status: number) => status === 429 || (status >= 500 && status <= 599 && status !== 501 && status !== 505);
