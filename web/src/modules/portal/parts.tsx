// Shared pieces of the portal: its configuration, status pills, the service banner, article
// suggestions and file sending.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, Button, errorMessage, Icon, qs, useDebounced, type IconName } from '../../core';
import { appTitle } from '../../core/branding';
import { catalogs, useI18n } from '../../core/i18n';

export interface Choice { value: string; label: string }
export interface PortalConfig {
  enabled: boolean;
  allowed: boolean;
  title: string;
  intro: string;
  banner: { message: string; tone: 'info' | 'warning' | 'outage' | 'resolved'; updated_at: string | null } | null;
  reopen_days: number;
  can_create: boolean;
  files: boolean;
  has: { assets: boolean; training: boolean; policies: boolean; changes: boolean; ticket_approvals: boolean; safety?: boolean };
  /** E15-12: who I may raise a request for, besides myself. */
  on_behalf?: 'nobody' | 'department' | 'anyone';
  affects: Choice[];
  urgency: Choice[];
}

export interface PlainStatus { key: string; label: string; hint: string; tone: string; done: boolean; waiting_on_you: boolean }
export interface Question { key: string; label: string; type: 'text' | 'longtext' | 'choice' | 'date' | 'yes_no'; required: boolean; options?: string[]; hint?: string }
export interface CatalogItem {
  id: string; name: string; description: string | null; category: string | null; category_label: string;
  questions: Question[]; requires_approval: boolean; type: 'incident' | 'request';
}
export interface Article { id: string; ref: string; title: string; excerpt: string; category_label: string | null }

const ConfigContext = createContext<PortalConfig | null>(null);
export const ConfigProvider = ConfigContext.Provider;

/**
 * The browser tab's title for a portal page: the page, the portal's name and the application name
 * ("My requests · Help and requests · Sandpiper GRC"), so a screen reader names the page on a fresh
 * load as it does in the main application (wave 15). The application name stays last, so a change of
 * branding (core/branding.ts) replaces it in place.
 */
export function usePortalTitle(title: string | null | undefined): void {
  const own = useContext(ConfigContext)?.title;
  const { t } = useI18n();
  const portal = own && catalogs.en?.['portal.title'] === own ? t('portal.title') : own;
  useEffect(() => {
    if (!title) return undefined;
    document.title = [title, portal && portal !== title ? portal : null, appTitle()].filter(Boolean).join(' · ');
    return () => { document.title = appTitle(); };
  }, [title, portal]);
}
/**
 * After a form is refused: once the messages are on the page, the focus goes to the first field that
 * needs something (a screen reader then reads it with its message), or else to the form's message.
 * Runs after the page shows the errors; a timer set while sending ran too early and lost the focus (E16-15).
 */
export function useFocusFirstProblem(): () => void {
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!tries) return undefined;
    const frame = requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(
        '.pt-form input[aria-invalid="true"], .pt-form textarea[aria-invalid="true"], .pt-form [aria-invalid="true"] input',
      );
      (field ?? document.querySelector<HTMLElement>('.pt-form-error'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [tries]);
  return useCallback(() => setTries((n) => n + 1), []);
}

export function usePortal(): PortalConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error('usePortal must be used inside the portal');
  return c;
}

/**
 * A text the server wrote in English (a request's plain status, a "who is affected" answer), in the
 * person's language: translated when it is the server's own wording, kept as it is when an
 * administrator wrote their own (a status's portal wording, for example).
 */
export function useServerText(): (key: string, english: string) => string {
  const { t } = useI18n();
  return useCallback((key: string, english: string) => (catalogs.en?.[key] === english ? t(key) : english), [t]);
}

export function StatusPill({ status }: { status: PlainStatus }) {
  const text = useServerText();
  return <span className={`pt-pill pt-tone-${status.tone}`}>{text(`portal.status.${status.key}.label`, status.label)}</span>;
}

const BANNER_ICON: Record<string, IconName> = { info: 'info', warning: 'alert', outage: 'alert-circle', resolved: 'check-circle' };
const BANNER_TONES = ['info', 'warning', 'outage', 'resolved'];

export function ServiceBanner() {
  const { banner } = usePortal();
  const { t } = useI18n();
  if (!banner) return null;
  return (
    <div className={`pt-banner pt-banner-${banner.tone}`} role={banner.tone === 'outage' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[banner.tone] ?? 'info'} size={22} />
      <div>
        <strong>{t(`portal.banner.${BANNER_TONES.includes(banner.tone) ? banner.tone : 'info'}`)}</strong>
        <p>{banner.message}</p>
      </div>
    </div>
  );
}

/** Articles that might answer the question, looked up as the person types. */
export function useSuggestions(text: string): Article[] {
  const q = useDebounced(text.trim(), 300);
  const [found, setFound] = useState<Article[]>([]);
  useEffect(() => {
    let live = true;
    if (q.length < 3) { setFound([]); return; }
    api.get<Article[]>(`/api/portal/knowledge${qs({ q })}`).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound([]); });
    return () => { live = false; };
  }, [q]);
  return found;
}

export function Suggestions({ articles, title }: { articles: Article[]; title?: string }) {
  const { t } = useI18n();
  if (!articles.length) return null;
  return (
    <aside className="pt-suggest" aria-live="polite">
      <h2 className="pt-suggest-title"><Icon name="book" size={18} /> {title ?? t('portal.suggest.title')}</h2>
      <ul>
        {articles.slice(0, 4).map((a) => (
          <li key={a.id}>
            <Link to={`/portal/knowledge/${a.id}`} target="_blank" rel="noopener">{a.title}</Link>
            <span className="muted">{a.excerpt}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="pt-section" aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="pt-section-head">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Sends one file to one of my requests. */
export async function sendFile(ticketId: string, file: File): Promise<void> {
  const res = await fetch(`/api/attachments/upload${qs({ record_type: 'ticket', record_id: ticketId, name: file.name })}`, {
    method: 'PUT', body: file, credentials: 'same-origin',
    headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
  });
  if (res.ok) return;
  let body: { error?: { code?: string; message?: string } } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  throw new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? `"${file.name}" could not be sent.`);
}

export function formatSize(n: number, t?: (key: string, vars?: Record<string, string | number>) => string): string {
  if (n < 1024) return t ? t('portal.size.bytes', { count: n }) : `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The portal's "could not be loaded" box, in the person's language. */
export function PortalError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state error-state" role="alert">
      <span className="state-icon state-icon-error"><Icon name="alert" size={22} /></span>
      <p className="state-title">{t('common.loadFailed')}</p>
      {error !== undefined && error !== null && <p className="state-message">{errorMessage(error)}</p>}
      {onRetry && <div className="state-action"><Button icon="refresh" onClick={onRetry}>{t('common.retry')}</Button></div>}
    </div>
  );
}

/** A file picker with a large target and the chosen files listed with a remove button. */
export function FilePicker({ files, onChange, label }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const { t } = useI18n();
  return (
    <div className="pt-files">
      <label className="pt-file-btn">
        <Icon name="upload" size={20} />
        <span>{label ?? t('portal.files.add')}</span>
        <input type="file" multiple className="sr-only" onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <ul className="pt-file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Icon name="file-text" size={18} />
              <span className="truncate">{f.name}</span>
              <span className="muted">{formatSize(f.size, t)}</span>
              <button type="button" className="pt-link-btn" aria-label={t('portal.files.removeNamed', { name: f.name })} onClick={() => onChange(files.filter((_, j) => j !== i))}>{t('portal.files.remove')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
