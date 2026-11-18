// Shared types and small pieces for the administration screens.
import { useState, type ReactNode } from 'react';
import { Button, StatusChip, useToast } from '../../core';
import type { ColorName } from '../../core';

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
export interface IssuedLink { link: string; expiresAt: string; purpose?: string }

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

export function UserStatus({ user }: { user: Pick<AdminUser, 'status' | 'locked'> }) {
  const s = STATUS[user.status] ?? { color: 'gray' as ColorName, label: user.status };
  return (
    <span className="row adm-chips">
      <StatusChip color={s.color} label={s.label} />
      {user.locked && <StatusChip color="red" label="Locked" />}
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Read-only text with a Copy button, for one-time links and keys. */
export function CopyBox({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      toast.success('Copied.');
    } else {
      toast.error('Copying was blocked by the browser. Select the text and copy it by hand.');
    }
  };
  return (
    <div className="adm-copy">
      <label className="field-label" htmlFor={`copy-${label}`}>{label}</label>
      <div className="row">
        <input id={`copy-${label}`} className="input adm-copy-input" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <Button icon={copied ? 'check' : 'clipboard'} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      {children}
    </div>
  );
}

/** The full address a person opens for a one-time link. */
export const absoluteLink = (path: string) => `${window.location.origin}${path}`;

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Before → after for one audit event, field by field where both sides are objects. */
export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  if ((before === null || before === undefined) && (after === null || after === undefined)) {
    return <p className="muted">No field values were recorded for this event.</p>;
  }
  const rows: { field: string; before: unknown; after: unknown }[] = [];
  if ((isPlainObject(before) || before == null) && (isPlainObject(after) || after == null)) {
    const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
    for (const k of keys) rows.push({ field: k, before: (before as Record<string, unknown> | null)?.[k], after: (after as Record<string, unknown> | null)?.[k] });
  } else {
    rows.push({ field: 'Value', before, after });
  }
  return (
    <table className="table adm-diff">
      <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field}>
            <th scope="row">{r.field}</th>
            <td className="adm-diff-before">{show(r.before)}</td>
            <td className="adm-diff-after">{show(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
