// A circuit breaker for outgoing mail (OP-09). When the mail server cannot be reached several
// times in a row, sending pauses for a few minutes: queued messages wait (without using up their
// attempts) instead of each spending a full connection time-out on a server that is down. After
// the pause one message tries again; if it gets through, sending resumes, otherwise the pause
// starts over. A test message from Administration > Email always tries for real.
//
// The state is per mail server (provider, host and port), in this process only.

export interface MailBreakerOptions {
  /** Connection failures in a row that pause sending (default 3). */
  threshold?: number;
  /** How long sending pauses, in milliseconds (default five minutes). */
  pauseMs?: number;
}

export interface MailBreaker {
  /** When sending to this server may be tried again, or null when it may be tried now. */
  pausedUntil(key: string, now?: number): Date | null;
  /** A message got through (or the server answered): the count starts over. */
  success(key: string): void;
  /** The server could not be reached. Returns the end of the pause when this failure starts one. */
  failure(key: string, now?: number): Date | null;
}

export const MAIL_BREAKER_DEFAULTS = { threshold: 3, pauseMs: 5 * 60_000 };

export function makeMailBreaker(opts: MailBreakerOptions = {}): MailBreaker {
  const threshold = Math.max(1, opts.threshold ?? MAIL_BREAKER_DEFAULTS.threshold);
  const pauseMs = Math.max(1000, opts.pauseMs ?? MAIL_BREAKER_DEFAULTS.pauseMs);
  const state = new Map<string, { failures: number; until: number }>();
  return {
    pausedUntil(key, now = Date.now()) {
      const s = state.get(key);
      return s && s.until > now ? new Date(s.until) : null;
    },
    success(key) { state.delete(key); },
    failure(key, now = Date.now()) {
      const s = state.get(key) ?? { failures: 0, until: 0 };
      s.failures += 1;
      state.set(key, s);
      if (s.failures < threshold) return null;
      s.until = now + pauseMs;
      return new Date(s.until);
    },
  };
}

/** The server a configuration sends to, as the breaker's key. */
export const breakerKey = (c: { provider: string; host: string; port: number }) => `${c.provider}:${c.host.toLowerCase()}:${c.port}`;
