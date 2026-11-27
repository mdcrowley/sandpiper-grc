// The evidence library: every evidence record with its figures, the records about to lapse, and one
// record with the records that use it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal, PageHeader,
  RecordPage, RecordPicker, ResourceList, Select, Stat, TableWrap, TextArea, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, Row } from '../../core';
import { EvidenceStateChip, stateOf } from './EvidencePanel';
import './evidence.css';

interface Summary { today: string; expiring_days: number; total: number; no_expiry: number; expired: number; expiring: number; current: number; unused: number; restricted: number; links: number }

const COLUMNS: ColumnDef[] = ['ref', 'title', { field: 'valid_until', priority: 1 }, { field: 'owner_id', priority: 2 }, { field: 'department_id', priority: 3 }, { field: 'source', priority: 3 }, { field: 'collected_on', priority: 3 }, { field: 'period_end', hidden: true }, { field: 'updated_at', hidden: true }];
const FILTERS = ['owner_id', 'department_id', 'source', 'valid_until', 'collected_on', 'restricted'];
const CREATE = ['title', 'description', 'owner_id', 'department_id', 'source', 'url', 'document_id', 'period_start', 'period_end', 'collected_on', 'valid_until', 'restricted', 'notes'];

function Figures({ s }: { s: Summary }) {
  return (
    <div className="grid-stats">
      <Stat label="Evidence records" value={s.total} icon="paperclip" hint={`${s.links} use${s.links === 1 ? '' : 's'} by other records`} />
      <Stat label="Lapse soon" value={s.expiring} icon="clock" color={s.expiring ? 'amber' : undefined} hint={`Within ${s.expiring_days} days`} to="/evidence-library/expiring" />
      <Stat label="Lapsed" value={s.expired} icon="alert" color={s.expired ? 'red' : undefined} hint="Past their valid-until date" to={`/evidence-library?f.valid_until.lt=${s.today}`} />
      <Stat label="Used by nothing" value={s.unused} icon="link" hint="Not linked to any record yet" />
    </div>
  );
}

export function EvidenceLibrary() {
  const { data: s, error } = useFetch<Summary>('/api/evidence-library/summary');
  return (
    <div className="stack">
      <PageHeader title="Evidence library" subtitle="Evidence filed once and used by many records: controls, obligations, audits, funder reviews and corrective actions." />
      {s ? <Figures s={s} /> : error ? null : <Loading lines={2} label="Loading the figures" />}
      <ResourceList
        type="evidence_record"
        urlState
        columns={COLUMNS}
        filters={FILTERS}
        createFields={CREATE}
      />
    </div>
  );
}

export function ExpiringEvidence() {
  const { data: s, error, reload } = useFetch<Summary>('/api/evidence-library/summary');
  // Up to and including the last day of the window: lapsed records first, then the soonest.
  const until = useMemo(() => {
    if (!s) return null;
    const d = new Date(`${s.today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + s.expiring_days + 1);
    return d.toISOString().slice(0, 10);
  }, [s]);
  return (
    <div className="stack">
      <PageHeader title="Evidence to renew" subtitle="Evidence that has lapsed or lapses soon. Collect a current copy and update the record: every record that uses it then has the new copy." />
      {error ? <ErrorState error={error} onRetry={reload} />
        : !s || !until ? <Loading lines={6} />
        : (
          <ResourceList
            type="evidence_record"
            baseFilter={{ 'valid_until.lt': until }}
            defaultSort={{ field: 'valid_until', dir: 'asc' }}
            columns={['ref', 'title', 'owner_id', 'department_id', 'valid_until', 'collected_on', { field: 'source', hidden: true }]}
            filters={['owner_id', 'department_id', 'source']}
          />
        )}
    </div>
  );
}

interface UsedByRow { link_id: string; record_type: string; type_label: string; record_id: string; ref: string | null; label: string; route: string; part: string; part_label: string | null; relation: string; note: string | null; linked_at: string }
interface LinkType { type: string; label: string; route: string; may_link: boolean }

function LinkToRecord({ evidenceId, onClose, onSaved }: { evidenceId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: types } = useFetch<LinkType[]>('/api/evidence-library/link-types');
  const usable = (types ?? []).filter((t) => t.may_link);
  const [type, setType] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [relation, setRelation] = useState('supports');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = type || usable[0]?.type || '';
  const dirty = Boolean(pick) || Boolean(note);
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    if (!pick || !kind) return;
    setBusy(true);
    try {
      await api.post('/api/evidence-links', { evidence_id: evidenceId, record_type: kind, record_id: pick, relation, note: note || null });
      unsaved.release();
      toast.success('Linked.');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Use this evidence for a record" size="sm" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={save}>Link</Button></>}>
      {!types ? <Loading lines={3} /> : usable.length === 0 ? (
        <EmptyState icon="lock" title="Nothing you may link to" message="Linking evidence changes the record it is used by, so it needs permission to edit that kind of record." />
      ) : (
        <div className="stack">
          <Select label="Kind of record" required value={kind} options={usable.map((t) => ({ value: t.type, label: t.label }))} onChange={(v) => { setType(v); setPick(null); }} />
          <RecordPicker key={kind} label={usable.find((t) => t.type === kind)?.label ?? 'Record'} type={kind} required value={pick} onChange={(id) => setPick(id)} />
          <LookupSelect label="How it relates" list="evidence_relation" required value={relation} onChange={setRelation} />
          <TextArea label="Note" value={note} rows={2} onChange={setNote} />
        </div>
      )}
    </Modal>
  );
}

function UsedBy({ row }: { row: Row }) {
  const toast = useToast();
  const { data: types } = useFetch<LinkType[]>('/api/evidence-library/link-types');
  const mayLink = (type: string) => Boolean(types?.find((t) => t.type === type)?.may_link);
  const { data, error, reload } = useFetch<{ rows: UsedByRow[]; hidden: number; total: number }>(`/api/evidence-library/${row.id}/used-by`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UsedByRow | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/evidence-links/${removing.link_id}`);
      toast.success('Link removed.'); setRemoving(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Used by" flush actions={<Button size="sm" icon="link" onClick={() => setAdding(true)}>Use for a record</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="ev-pad"><Loading lines={3} /></div>
        : data.total === 0 ? <EmptyState icon="link" title="Not used by any record yet" message="Link it to the controls, obligations, audit requests or funder review areas it supports." />
        : (
          <>
            {data.rows.length > 0 && (
              <TableWrap label="Records that use this evidence">
                <table className="table">
                  <caption className="sr-only">Records that use this evidence</caption>
                  <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">For</th><th scope="col">Relation</th><th scope="col">Linked</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.link_id}>
                        <td>
                          <Link className="row-title" to={r.route}>{r.ref && <span className="ref">{r.ref}</span>} {r.label}</Link>
                          {r.note && <span className="muted ev-small ev-block">{r.note}</span>}
                        </td>
                        <td>{r.type_label}</td>
                        <td>{r.part_label ?? 'The record itself'}</td>
                        <td><LookupChip list="evidence_relation" value={r.relation} /></td>
                        <td>{formatDate(r.linked_at)}</td>
                        <td className="ev-row-actions">
                          {mayLink(r.record_type) && <Button size="sm" variant="ghost" aria-label={`Remove link: ${r.label}`} onClick={() => setRemoving(r)}>Remove</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {data.hidden > 0 && <p className="muted ev-pad ev-small">Also used by {data.hidden} record{data.hidden === 1 ? '' : 's'} you cannot open.</p>}
          </>
        )}
      {adding && <LinkToRecord evidenceId={String(row.id)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this link?" message={`${removing?.label ?? 'The record'} will no longer use this evidence. The evidence record stays in the library.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function Validity({ row }: { row: Row }) {
  const { data: s } = useFetch<Summary>('/api/evidence-library/summary');
  if (!s) return null;
  const state = stateOf(row.valid_until as string | null, s.today, s.expiring_days);
  return <EvidenceStateChip state={state} validUntil={row.valid_until as string | null} />;
}

export function EvidenceDetail() {
  return (
    <RecordPage
      type="evidence_record"
      status={(row) => <Validity row={row} />}
      summaryFields={['title', 'description', 'owner_id', 'department_id', 'source', 'url', 'document_id', 'period_start', 'period_end', 'collected_on', 'valid_until', 'restricted', 'notes']}
      tabs={[{ key: 'used', label: 'Used by', content: ({ row }) => <UsedBy row={row} /> }]}
      evidence
    />
  );
}
