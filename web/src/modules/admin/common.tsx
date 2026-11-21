// Shared types and small pieces for the administration screens.
import { useId, useState, type ReactNode } from 'react';
import { Button, cx, humanize, Icon, lookupLabel, StatusChip, useMeta, useToast } from '../../core';
import type { ColorName, IconName } from '../../core';

export interface RoleRef { key: string; name: string; enabled: boolean; requires_mfa?: boolean }

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  display_name: string;
  status: 'pending' | 'active' | 'disabled';
  department_id: string | null;
  department: string | null;
  totp_enabled: boolean;
  /** Passkeys and security keys in use (second factors too). */
  passkeys?: number;
  locked: boolean;
  locked_until: string | null;
  failed_attempts: number;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  has_password: boolean;
  roles: RoleRef[];
  link_pending: boolean;
  sessions: number;
  /** Linked single sign-on identities. */
  identities: number;
  break_glass: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  requires_mfa: boolean;
  grants: string[];
  members: number;
  users?: { id: string; username: string; display_name: string; status: string }[];
}

export interface RolesResponse { roles: Role[]; modules: string[]; actions: string[] }
export interface Department { id: string; name: string; members: number }
export interface IssuedLink { link: string; expiresAt: string; purpose?: string; /** Set when the link was also emailed to the person. */ emailedTo?: string | null }

export interface AuditEvent {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  ip: string | null;
  action: string;
  record_type: string | null;
  record_id: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
}

const STATUS: Record<string, { color: ColorName; label: string }> = {
  pending: { color: 'amber', label: 'Waiting for setup' },
  active: { color: 'green', label: 'Active' },
  disabled: { color: 'gray', label: 'Disabled' },
};

export function UserStatus({ user }: { user: Pick<AdminUser, 'status' | 'locked'> & { break_glass?: boolean } }) {
  const s = STATUS[user.status] ?? { color: 'gray' as ColorName, label: user.status };
  return (
    <span className="row adm-chips">
      <StatusChip color={s.color} label={s.label} />
      {user.locked && <StatusChip color="red" label="Locked" />}
      {user.break_glass && <StatusChip color="red" label="Break-glass" title="The emergency administrator account: password only, every sign-in alerts administrators" />}
    </span>
  );
}

export function RoleChips({ roles }: { roles: RoleRef[] }) {
  if (roles.length === 0) return <span className="muted">No role</span>;
  return (
    <span className="row adm-chips">
      {roles.map((r) => (
        <span key={r.key} className={`chip chip-${r.enabled ? 'blue' : 'gray'}`} title={r.enabled ? undefined : 'This role is switched off'}>
          {r.name}{r.enabled ? '' : ' (off)'}
        </span>
      ))}
    </span>
  );
}

/** Initials in a soft circle, beside a person's name. Decorative: the name is always next to it. */
export function Initials({ name }: { name: string }) {
  // Words that start with a letter or digit only: "[Sample] Avery Lindqvist" gives "AL", not "[L".
  const parts = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const text = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  return <span className="adm-initials" aria-hidden="true">{text}</span>;
}

/** A short message box. The text sits in one block, so bold words and links flow as a sentence. */
export function Notice({ tone = 'info', icon, role = 'note', children }: {
  tone?: 'info' | 'caution' | 'danger' | 'success'; icon?: IconName; role?: 'note' | 'status' | 'alert'; children: ReactNode;
}) {
  const look = { info: '', caution: 'notice-pilot', danger: 'notice-warn', success: 'notice-success' }[tone];
  const fallback: IconName = tone === 'success' ? 'check-circle' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={cx('notice', look)} role={role}>
      <Icon name={icon ?? fallback} size={16} />
      <div className="adm-notice-text">{children}</div>
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page not served over a secure connection: copy through a hidden text box.
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Saves text as a file from the browser. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read-only text with a Copy button, for one-time links and keys.
 * `prominent` draws it as a large framed box; `testId` becomes `data-testid` on the element holding the value.
 */
export function CopyBox({ label, value, display, prominent, copyLabel = 'Copy', testId, children }: {
  label: string; value: string; display?: string; prominent?: boolean; copyLabel?: string; testId?: string; children?: ReactNode;
}) {
  const toast = useToast();
  const id = useId();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      toast.success('Copied.');
      window.setTimeout(() => setCopied(false), 4000);
    } else {
      toast.error('Copying was blocked by the browser. Select the text and copy it by hand.');
    }
  };
  return (
    <div className={cx('adm-copy', prominent && 'adm-copy-prominent')}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="adm-copy-row">
        {prominent ? (
          <textarea
            id={id} className="adm-copy-value" readOnly rows={display ? 2 : 3} value={display ?? value}
            data-testid={testId} data-value={value} spellCheck={false} onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          <input
            id={id} className="input adm-copy-input" readOnly value={display ?? value} data-testid={testId} data-value={value}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <Button variant={prominent ? 'primary' : 'secondary'} icon={copied ? 'check' : 'clipboard'} onClick={() => void copy()}>
          {copied ? 'Copied' : copyLabel}
        </Button>
      </div>
      <span className="sr-only" role="status">{copied ? 'Copied to the clipboard.' : ''}</span>
      {children}
    </div>
  );
}

/** The full address a person opens for a one-time link. */
export const absoluteLink = (path: string) => `${window.location.origin}${path}`;

// ---------- filters shown as pills ----------

export interface FilterPill { key: string; label: string; value: string; onRemove: () => void }

/** The filters in force, each with a button that removes it. Renders nothing when there are none. */
export function FilterPills({ pills, onClear }: { pills: FilterPill[]; onClear: () => void }) {
  if (pills.length === 0) return null;
  return (
    <div className="adm-pills" role="group" aria-label="Filters in use">
      {pills.map((p) => (
        <span key={p.key} className="adm-pill">
          <span className="adm-pill-label">{p.label}:</span> <span className="adm-pill-value">{p.value}</span>
          <button type="button" className="adm-pill-remove" aria-label={`Remove filter ${p.label}: ${p.value}`} onClick={p.onRemove}>
            <Icon name="x" size={14} />
          </button>
        </span>
      ))}
      {pills.length > 1 && <Button size="sm" variant="ghost" onClick={onClear}>Clear all</Button>}
    </div>
  );
}

/** Count on the left, page buttons on the right, under a table. */
export function Pager({ summary, page, pages, onPage, previous = 'Previous', next = 'Next' }: {
  summary: ReactNode; page: number; pages: number; onPage: (page: number) => void; previous?: string; next?: string;
}) {
  return (
    <div className="adm-foot">
      <span className="muted" role="status">{summary}</span>
      {pages > 1 && (
        <nav className="row" aria-label="Pages">
          <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>{previous}</Button>
          <span className="muted">Page {page} of {pages}</span>
          <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{next}</Button>
        </nav>
      )}
    </div>
  );
}

// ---------- before and after ----------

const FOLD_AT = 140;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const isSimpleList = (v: unknown): v is (string | number)[] => Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number');

/** Long text or JSON, folded to one line until opened. */
function Folded({ text, code }: { text: string; code?: boolean }) {
  return (
    <details className="adm-fold">
      <summary>
        <span className="adm-fold-preview">{text.replace(/\s+/g, ' ').slice(0, 60)}…</span>
        <span className="adm-fold-more">Show all ({text.length.toLocaleString('en-US')} characters)</span>
      </summary>
      <pre className={code ? 'adm-fold-code' : 'adm-fold-text'}>{text}</pre>
    </details>
  );
}

function Value({ value, list }: { value: unknown; list?: string }) {
  if (isEmpty(value)) return <span className="muted">empty</span>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (isSimpleList(value)) {
    const text = value.join(', ');
    return text.length > FOLD_AT ? <Folded text={text} /> : <>{text}</>;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value, null, 2);
    return json.length > FOLD_AT ? <Folded text={json} code /> : <code>{JSON.stringify(value)}</code>;
  }
  const text = list && typeof value === 'string' ? lookupLabel(list, value) || value : String(value);
  return text.length > FOLD_AT ? <Folded text={text} /> : <>{text}</>;
}

/** Two lists compared: what was taken out, what was put in, and how many stayed. */
function ListChange({ before, after }: { before: (string | number)[]; after: (string | number)[] }) {
  const removed = before.filter((x) => !after.includes(x));
  const added = after.filter((x) => !before.includes(x));
  const kept = after.length - added.length;
  return (
    <span className="adm-diff-list">
      {removed.map((x) => <del key={`r${x}`} className="adm-diff-old"><span className="sr-only">Removed: </span>{String(x)}</del>)}
      {added.map((x) => <ins key={`a${x}`} className="adm-diff-new"><span className="sr-only">Added: </span>{String(x)}</ins>)}
      {removed.length + added.length === 0 && <span className="muted">Same values, different order</span>}
      {kept > 0 && <span className="muted">{kept} unchanged</span>}
    </span>
  );
}

/**
 * Before and after for one audit event: one line for each field, the old value struck through, an
 * arrow, then the new value. Field and list labels come from the record type when it is known.
 */
export function AuditDiff({ before, after, recordType }: { before: unknown; after: unknown; recordType?: string | null }) {
  const { resources } = useMeta();
  if ((before === null || before === undefined) && (after === null || after === undefined)) {
    return <p className="muted">No field values were recorded for this event.</p>;
  }
  const fields = recordType ? resources?.[recordType]?.fields : undefined;
  const rows: { key: string; label: string; list?: string; before: unknown; after: unknown }[] = [];
  if ((isPlainObject(before) || before == null) && (isPlainObject(after) || after == null)) {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = (after ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (JSON.stringify(b[key]) === JSON.stringify(a[key]) && before != null && after != null) continue;
      rows.push({ key, label: fields?.[key]?.label ?? humanize(key.replace(/[.]/g, '_')), list: fields?.[key]?.list, before: b[key], after: a[key] });
    }
  } else {
    rows.push({ key: 'value', label: 'Value', before, after });
  }
  if (rows.length === 0) return <p className="muted">The recorded values are the same before and after.</p>;
  const created = before === null || before === undefined;
  const removed = after === null || after === undefined;

  return (
    <dl className="adm-diff">
      {rows.map((r) => (
        <div key={r.key} className="adm-diff-row">
          <dt title={r.key}>{r.label}</dt>
          <dd>
            {isSimpleList(r.before) && isSimpleList(r.after) && !created && !removed ? <ListChange before={r.before} after={r.after} /> : (
              <>
                {!created && (
                  <del className={cx('adm-diff-old', isEmpty(r.before) && 'adm-diff-none')}>
                    <span className="sr-only">Before: </span><Value value={r.before} list={r.list} />
                  </del>
                )}
                {!created && !removed && <span className="adm-diff-arrow" aria-hidden="true">→</span>}
                {!removed && (
                  <ins className={cx('adm-diff-new', isEmpty(r.after) && 'adm-diff-none')}>
                    <span className="sr-only">After: </span><Value value={r.after} list={r.list} />
                  </ins>
                )}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
