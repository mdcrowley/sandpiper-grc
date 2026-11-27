// Roster acknowledgments on a policy (E29-09): who on the roster was asked, and a dialog to record
// acknowledgments from a sign-in sheet or by hand. Shown to people who may view the roster.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, Select, Stat,
  StatusChip, TableWrap, TextArea, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { ACK_STATE, readIn } from './shared';

interface RosterRow {
  id: string; person_id: string; person: string; employee_number: string | null; position: string | null; state: 'acknowledged' | 'outstanding' | 'overdue' | 'superseded';
  due_on: string | null; acknowledged_at: string | null; method: string | null; recorded_by_name: string | null; sheet_attachment_id: string | null;
  /** The language read (E41-07). */
  language?: string | null;
  /** The stamp of the translated text read (W23 F5). */
  translation_sha256?: string | null;
}
interface RosterTracking {
  version: { version: number } | null;
  counts: { total: number; acknowledged: number; outstanding: number; overdue: number };
  rows: RosterRow[];
  positions: { position: string | null; total: number; acknowledged: number; outstanding: number; overdue: number }[];
}
const METHOD: Record<string, string> = { sign_in_sheet: 'Sign-in sheet', kiosk: 'Kiosk', recorded: 'By hand' };

function RecordDialog({ policy, onClose, onDone }: { policy: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const files = useFetch<{ rows?: { id: string; file_name: string }[] } | { id: string; file_name: string }[]>(
    `/api/attachments?record_type=policy&record_id=${policy.id}`);
  const fileList = Array.isArray(files.data) ? files.data : files.data?.rows ?? [];
  const [numbers, setNumbers] = useState('');
  const [method, setMethod] = useState('sign_in_sheet');
  const [on, setOn] = useState<string>(todayInZone());
  const [sheet, setSheet] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const list = numbers.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true); setErrors({}); setMessage('');
    try {
      const res = await api.post<{ recorded: number; already: number; unknown: string[] }>(`/api/policies/${policy.id}/person-acknowledgments`, {
        employee_numbers: list, method, acknowledged_on: on || undefined, ...(method === 'sign_in_sheet' && sheet ? { sheet_attachment_id: sheet } : {}),
      });
      const parts = [`${res.recorded} recorded`, res.already ? `${res.already} had already acknowledged` : '', res.unknown.length ? `not on the roster: ${res.unknown.join(', ')}` : ''].filter(Boolean);
      (res.unknown.length ? toast.error : toast.success)(parts.join('; ') + '.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields); else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Record acknowledgments" onClose={onClose} dirty={!!numbers}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!list.length} onClick={() => void save()}>Record {list.length || ''}</Button></>}>
      <div className="stack">
        {message && <div className="form-error" role="alert">{message}</div>}
        <p className="muted">For the published version of {[policy.ref, policy.title].filter(Boolean).join(' ')}. You are recorded as the person who recorded them.</p>
        <TextArea label="Employee numbers" value={numbers} onChange={setNumbers} rows={4} error={errors.people}
          hint="From the sign-in sheet: one per line, or separated by commas or spaces." />
        <Select label="How" value={method} onChange={(v) => setMethod(v || 'sign_in_sheet')} error={errors.method}
          options={[{ value: 'sign_in_sheet', label: 'Sign-in sheet' }, { value: 'recorded', label: 'Recorded by hand' }]} />
        <DateField label="Acknowledged on" value={on} onChange={setOn} max={todayInZone()} error={errors.acknowledged_on} />
        {method === 'sign_in_sheet' && (
          <Select label="Scanned sheet" value={sheet} onChange={(v) => setSheet(v ?? '')} error={errors.sheet_attachment_id}
            options={[{ value: '', label: 'None' }, ...fileList.map((f) => ({ value: f.id, label: f.file_name }))]}
            hint="Add the scanned sheet to this policy on its Evidence files tab first, then choose it here." />
        )}
      </div>
    </Modal>
  );
}

/** The roster section of a policy's Acknowledgments tab. */
export function RosterAcks({ policy, versionNumber }: { policy: Row; versionNumber: string }) {
  const { can } = useAuth();
  const [recording, setRecording] = useState(false);
  const allowed = can('people.view');
  const { data, error, reload } = useFetch<RosterTracking>(allowed ? `/api/policies/${policy.id}/person-acknowledgments${versionNumber ? `?version=${versionNumber}` : ''}` : null);
  if (!allowed) return null;
  if (error) return <Card title="Staff on the roster"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Staff on the roster"><Loading lines={3} label="Loading roster acknowledgments" /></Card>;
  if (!data.rows.length && !policy.ack_roster) return null;
  const canRecord = can('policies.edit') && policy.status === 'published';
  return (
    <Card title="Staff on the roster" flush={!!data.rows.length}
      actions={canRecord && (
        <span className="row">
          <Link className="btn btn-secondary btn-sm" to="/documents/kiosk">Open the kiosk</Link>
          <Button size="sm" icon="check" onClick={() => setRecording(true)}>Record acknowledgments</Button>
        </span>
      )}>
      {!data.rows.length ? (
        <EmptyState icon="users" title="Nobody on the roster was asked"
          message="Roster people in the chosen positions are asked when a version is published. You can still record anyone on the roster." />
      ) : (
        <>
          <div className="grid-stats pol-roster-stats">
            <Stat label="Asked" value={data.counts.total} size="sm" />
            <Stat label="Acknowledged" value={data.counts.acknowledged} color="green" size="sm" />
            <Stat label="Outstanding" value={data.counts.outstanding} color={data.counts.outstanding ? 'amber' : undefined} size="sm" />
            <Stat label="Overdue" value={data.counts.overdue} color={data.counts.overdue ? 'red' : undefined} size="sm" />
          </div>
          <TableWrap label="Roster acknowledgments" className="pol-tw">
            <table className="table">
              <caption className="sr-only">Roster acknowledgments</caption>
              <thead>
                <tr><th scope="col">Person</th><th scope="col">Employee number</th><th scope="col">Position</th><th scope="col">Status</th><th scope="col">Acknowledged</th><th scope="col">How</th><th scope="col">Recorded by</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/people/${r.person_id}`}>{r.person}</Link></td>
                    <td>{r.employee_number ?? '–'}</td>
                    <td>{r.position ?? '–'}</td>
                    <td><StatusChip color={ACK_STATE[r.state].color} label={ACK_STATE[r.state].label} /></td>
                    <td>{r.acknowledged_at ? `${formatDate(r.acknowledged_at)}${readIn(r.language, r.translation_sha256)}` : r.due_on ? `Due ${formatDate(r.due_on)}` : '–'}</td>
                    <td>{r.method ? <Badge color="gray">{METHOD[r.method] ?? r.method}</Badge> : '–'}</td>
                    <td>{r.recorded_by_name ?? (r.acknowledged_at ? 'Sample data or import' : '–')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </>
      )}
      {recording && <RecordDialog policy={policy} onClose={() => setRecording(false)} onDone={() => { setRecording(false); reload(); }} />}
    </Card>
  );
}
