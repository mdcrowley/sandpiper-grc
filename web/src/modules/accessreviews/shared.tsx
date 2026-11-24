// Shared pieces of the user access review pages (E41-02): the section tabs, the figures, the import
// dialog for one system's account file and the panels other modules offer.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, Checkbox, ErrorState, errorMessage, Loading, Modal, Notice, RecordPicker, Stat, Tabs, useAuth, useFetch, useToast,
} from '../../core';

const SECTIONS = [
  { key: 'reviews', label: 'Review campaigns', path: '/access-reviews', permission: 'systems.view' },
  { key: 'accounts', label: 'Accounts on systems', path: '/access-reviews/accounts', permission: 'systems.view' },
  { key: 'mine', label: 'My access reviews', path: '/access-reviews/mine' },
] as const;

export function AccessTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const shown = SECTIONS.filter((s) => !('permission' in s) || can(s.permission));
  if (shown.length < 2) return null;
  return (
    <Tabs label="Access review sections" active={active} tabs={shown.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/access-reviews')} />
  );
}

export interface Summary {
  accounts: { active: number; leavers: number; onLeave: number; unmatched: number; privileged: number; systems: number };
  campaigns: { running: number; overdue: number; lastCompleted: string | null };
  removals: { pending: number; overdue: number };
}

/** The figures: the same for everyone who may see the page. */
export function SummaryTiles() {
  const { data, error, reload } = useFetch<Summary>('/api/access-reviews/summary');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} label="Loading the figures" />;
  const accounts = '/access-reviews/accounts';
  return (
    <div className="grid-stats">
      <Stat label="Active accounts" icon="key" value={data.accounts.active} hint={`On ${data.accounts.systems} system${data.accounts.systems === 1 ? '' : 's'}`} to={`${accounts}?f.status=active`} />
      <Stat label="Holder has left" icon="alert" color={data.accounts.leavers ? 'red' : undefined} value={data.accounts.leavers} to={`${accounts}?f.attention=leaver`} hint="Active accounts" />
      <Stat label="Holder on leave" icon="clock" color={data.accounts.onLeave ? 'amber' : undefined} value={data.accounts.onLeave} to={`${accounts}?f.attention=on_leave`} hint="Active accounts" />
      <Stat label="Not on the staff roster" icon="users" color={data.accounts.unmatched ? 'orange' : undefined} value={data.accounts.unmatched} to={`${accounts}?f.attention=unmatched`} hint="Personal accounts" />
      <Stat label="Campaigns in progress" icon="calendar" value={data.campaigns.running} hint={data.campaigns.overdue ? `${data.campaigns.overdue} overdue` : 'None overdue'} to="/access-reviews?f.status=in_progress" />
      <Stat label="Removals to do" icon="check-square" color={data.removals.overdue ? 'red' : undefined} value={data.removals.pending} hint={data.removals.overdue ? `${data.removals.overdue} overdue` : 'None overdue'} />
    </div>
  );
}

interface ImportResult {
  dryRun: boolean; system: { id: string; name: string }; columns: Record<string, string>; rows: number;
  created: number; updated: number; unchanged: number; missing: number; removedConfirmed: number;
  errors: { line: number; message: string }[]; warnings: string[];
}

const FIELD_LABELS: Record<string, string> = {
  account_name: 'Account', display_name: 'Name', email: 'Email', employee_number: 'Employee number', role_on_system: 'Role',
  last_seen_on: 'Last seen', status: 'Status', account_kind: 'Kind', privileged: 'Privileged',
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

/**
 * Imports one system's own export of its accounts (CSV or Excel). A check runs first and says what
 * would change; the import then creates and updates accounts and, unless unticked, marks accounts that
 * are no longer in the file as removed.
 */
export function ImportDialog({ open, onClose, onDone, systemId: fixed }: { open: boolean; onClose: () => void; onDone: () => void; systemId?: string }) {
  const toast = useToast();
  const [systemId, setSystemId] = useState<string | null>(fixed ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [markMissing, setMarkMissing] = useState(true);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setFile(null); setCheck(null); setError(null); setMarkMissing(true); if (!fixed) setSystemId(null); };
  const close = () => { reset(); onClose(); };

  const send = async (dryRun: boolean) => {
    if (!systemId || !file) return;
    setBusy(true);
    setError(null);
    try {
      const content = await readFile(file);
      const res = await api.post<ImportResult>('/api/system-accounts/import', { system_id: systemId, fileName: file.name, content, markMissing, dryRun });
      if (dryRun) setCheck(res);
      else {
        toast.success(`Imported: ${res.created} new, ${res.updated} changed, ${res.missing} no longer listed.`);
        reset();
        onDone();
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Import accounts from a system's file" onClose={close} size="md"
      footer={(
        <div className="row ar-dialog-buttons">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {check
            ? <Button variant="primary" icon="upload" loading={busy} onClick={() => send(false)}>Import</Button>
            : <Button variant="primary" loading={busy} disabled={!systemId || !file} onClick={() => send(true)}>Check the file</Button>}
        </div>
      )}>
      <div className="stack">
        <p className="muted">Export the list of accounts from the system (CSV or Excel). The first row names the columns; one must hold the account name (Account, Username or Login). Name, Email, Employee number, Role, Last login, Status, Kind and Privileged are read when present.</p>
        {!fixed && (
          <RecordPicker label="System" type="system" value={systemId} required placeholder="Search by reference or name"
            onChange={(id) => { setSystemId(id); setCheck(null); }} />
        )}
        <label className="ar-file">
          <span className="ar-file-label">File</span>
          <input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheck(null); }} />
        </label>
        <Checkbox label="Mark accounts that are not in the file as removed" checked={markMissing}
          onChange={(v) => { setMarkMissing(v); setCheck(null); }}
          hint="Use a complete export. Removals waiting on those accounts in a review are then recorded as done." />
        {error && <Notice tone="error">{error}</Notice>}
        {check && (
          <Notice tone={check.errors.length ? 'warning' : 'info'} title={`${check.rows} row${check.rows === 1 ? '' : 's'} read for ${check.system.name}`}>
            <p>{check.created} new, {check.updated} changed, {check.unchanged} unchanged{markMissing ? `, ${check.missing} no longer listed (will be marked removed)` : ''}.</p>
            <p>Columns used: {Object.entries(check.columns).map(([f, h]) => `${FIELD_LABELS[f] ?? f} from "${h}"`).join('; ')}.</p>
            {check.warnings.map((w) => <p key={w}>{w}</p>)}
            {check.errors.length > 0 && (
              <ul className="ar-errors">
                {check.errors.slice(0, 10).map((e) => <li key={`${e.line}-${e.message}`}>Line {e.line}: {e.message}</li>)}
                {check.errors.length > 10 && <li>and {check.errors.length - 10} more</li>}
              </ul>
            )}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
