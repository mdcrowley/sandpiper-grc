// Shared pieces of the portal: its configuration, status pills, the service banner, article
// suggestions and file sending.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, Icon, qs, useDebounced, type IconName } from '../../core';

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
export function usePortal(): PortalConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error('usePortal must be used inside the portal');
  return c;
}

export function StatusPill({ status }: { status: PlainStatus }) {
  return <span className={`pt-pill pt-tone-${status.tone}`}>{status.label}</span>;
}

const BANNER_ICON: Record<string, IconName> = { info: 'info', warning: 'alert', outage: 'alert-circle', resolved: 'check-circle' };
const BANNER_TITLE: Record<string, string> = { info: 'Service update', warning: 'Service warning', outage: 'Service problem', resolved: 'Service restored' };

export function ServiceBanner() {
  const { banner } = usePortal();
  if (!banner) return null;
  return (
    <div className={`pt-banner pt-banner-${banner.tone}`} role={banner.tone === 'outage' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[banner.tone] ?? 'info'} size={22} />
      <div>
        <strong>{BANNER_TITLE[banner.tone] ?? 'Service update'}</strong>
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

export function Suggestions({ articles, title = 'These articles might help' }: { articles: Article[]; title?: string }) {
  if (!articles.length) return null;
  return (
    <aside className="pt-suggest" aria-live="polite">
      <h2 className="pt-suggest-title"><Icon name="book" size={18} /> {title}</h2>
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

export function formatSize(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file picker with a large target and the chosen files listed with a remove button. */
export function FilePicker({ files, onChange, label = 'Add a photo or file' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  return (
    <div className="pt-files">
      <label className="pt-file-btn">
        <Icon name="upload" size={20} />
        <span>{label}</span>
        <input type="file" multiple className="sr-only" onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <ul className="pt-file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Icon name="file-text" size={18} />
              <span className="truncate">{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
              <button type="button" className="pt-link-btn" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
