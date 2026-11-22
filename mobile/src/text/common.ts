// Text used by more than one screen.
export const commonText = {
  loading: 'Loading',
  retry: 'Try again',
  /** A short relative time: "just now", "5 min ago", "3 h ago", or the date. */
  ago(iso: string, now = Date.now()): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return new Date(t).toISOString().slice(0, 10);
  },
} as const;
