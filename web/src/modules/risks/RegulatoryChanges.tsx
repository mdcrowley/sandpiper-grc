import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading,
  LookupChip, LookupSelect, Modal, PageHeader, RecordPage, RecordPicker, ResourceList, Select, Stat, TableWrap, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { ListResult, RecordContext, StatsResult } from '../../core';
import { ActionsPanel } from './ActionsPanel';
import { DueChip } from './scales';

// Regulatory change intake (E30-04, E30-05): the list and one change, with the records it affects
// (links with the relation "affects"), the obligations made from it, draft policy revisions and its actions.

/** Record types a change may be said to affect: those shown to this person (switched-off areas are absent from the metadata). */
const AFFECTABLE = ['policy', 'obligation', 'control'];

export function RegulatoryChangeList() {
  const stats = useFetch<StatsResult>('/api/regulatory-changes/stats?group=status');
  const high = useFetch<ListResult>('/api/regulatory-changes?f.impact_level=high&f.status=identified,assessing,implementing&pageSize=1');
  const count = (v: string) => stats.data?.groups.find((g) => g.value === v)?.count ?? 0;
  const open = count('identified') + count('assessing') + count('implementing');

  return (
    <div className="stack">
      <PageHeader
        title="Regulatory changes"
        subtitle="New or changed laws, rules, standards and funding terms: what each one means for the organization and how it is put into effect."
        actions={<Link className="btn btn-secondary" to="/obligations">Obligations</Link>}
      />
      <div className="grid-stats">
        <Stat label="Open changes" value={stats.data ? open : '–'} color="blue" icon="file-text" to="/regulatory-changes?f.status=identified,assessing,implementing" />
        <Stat label="To assess" value={stats.data ? count('identified') + count('assessing') : '–'} color="amber" to="/regulatory-changes?f.status=identified,assessing" />
        <Stat label="High impact, open" value={high.data?.total ?? '–'} color={(high.data?.total ?? 0) > 0 ? 'red' : 'green'} to="/regulatory-changes?f.impact_level=high&f.status=identified,assessing,implementing" />
        <Stat label="Implemented" value={stats.data ? count('implemented') : '–'} color="green" to="/regulatory-changes?f.status=implemented" />
      </div>
      <ResourceList
        type="regulatory_change"
        urlState
        columns={[
          'ref', 'title', 'issuer', 'impact_level', 'status',
          {
            field: 'effective_on', label: 'Takes effect', sortable: true,
            render: (row) => (row.effective_on
              ? <span className="rk-two-line"><span>{formatDate(row.effective_on)}</span>{!['implemented', 'not_applicable'].includes(row.status) && <DueChip date={row.effective_on} warnDays={60} overdueWord="In effect for" />}</span>
              : <span className="muted">No date</span>),
          },
          'owner_id', { field: 'citation', hidden: true }, { field: 'published_on', hidden: true },
        ]}
        filters={['status', 'impact_level', 'owner_id', 'effective_on']}
        bulkFields={['status', 'impact_level', 'owner_id']}
        defaultSort={{ field: 'effective_on', dir: 'asc' }}
        createFields={['title', 'issuer', 'citation', 'published_on', 'effective_on', 'summary', 'impact_level', 'owner_id']}
      />
    </div>
  );
}

interface Affected { link_id: string; type: string; type_label: string; id: string; ref: string | null; label: string | null; route: string; status: string | null }

/** Makes an obligation from the change; it is linked as an affected record. */
function ObligationDialog({ change, onClose, onDone }: { change: Record<string, any>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(change.title ?? '');
  const [type, setType] = useState('law');
  const [frequency, setFrequency] = useState('');
  const [due, setDue] = useState<string>(change.effective_on ? String(change.effective_on).slice(0, 10) : '');
  const [start] = useState(() => JSON.stringify([title, type, frequency, due]));
  const dirty = JSON.stringify([title, type, frequency, due]) !== start;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const made = await api.post<{ id: string; ref: string }>(`/api/regulatory-changes/${change.id}/obligation`, { title, type, frequency: frequency || undefined, next_due_on: due || undefined });
      toast.success(`Obligation ${made.ref} made and linked.`);
      onDone();
      onClose();
      navigate(`/obligations/${made.id}`);
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : {});
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Make an obligation" size="md" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>The new obligation takes its source, requirement and owner from this change, and is listed under its affected records.</p>
        {message && <p role="alert" className="form-error">{message}</p>}
        <TextField label="Obligation" required value={title} onChange={setTitle} error={errors.title} />
        <div className="form-grid">
          <LookupSelect list="obligation_type" label="Type" value={type} onChange={(v) => setType(v || '')} error={errors.type} />
          <LookupSelect list="obligation_frequency" label="Frequency" value={frequency} onChange={(v) => setFrequency(v || '')} error={errors.frequency} />
          <DateField label="Next due" value={due} onChange={setDue} error={errors.next_due_on} hint="Defaults to the date the change takes effect." />
        </div>
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Make obligation</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Links an existing record as affected by the change. */
function AffectDialog({ changeId, onClose, onDone }: { changeId: string; onClose: () => void; onDone: () => void }) {
  const { resources } = useMeta();
  const { can } = useAuth();
  const types = AFFECTABLE.filter((t) => resources[t] && can(`${resources[t].module}.view`));
  const [type, setType] = useState(types[0] ?? '');
  const [firstType] = useState(type);
  const [id, setId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) { setMessage('Choose a record.'); return; }
    setSaving(true);
    try {
      await api.post('/api/links', { from_type: 'regulatory_change', from_id: changeId, to_type: type, to_id: id, relation: 'affects' });
      onDone();
      onClose();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Add an affected record" size="md" onClose={onClose} dirty={Boolean(id) || type !== firstType}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <p role="alert" className="form-error">{message}</p>}
        <Select label="Kind of record" required value={type} options={types.map((t) => ({ value: t, label: resources[t].label }))} onChange={(v) => { setType(v || ''); setId(null); }} />
        {type && <RecordPicker key={type} type={type} label={resources[type]?.label ?? 'Record'} required value={id} onChange={(v) => setId(v)} />}
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Add</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Starts a draft revision of an affected policy through the policies API: a copy of the published text, to edit there. */
async function startRevision(policyId: string, change: Record<string, any>): Promise<void> {
  const versions = await api.get<{ status: string; body: string }[]>(`/api/policies/${policyId}/versions`);
  const current = versions.find((v) => v.status === 'published') ?? versions[0];
  await api.post(`/api/policies/${policyId}/versions`, {
    body: current?.body || `Draft revision for ${change.ref}: ${change.title}.`,
    change_summary: `Revision for ${change.ref}: ${change.title}`,
  });
}

function AffectedPanel({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const { can, areaOn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<Affected[]>(`/api/regulatory-changes/${row.id}/affected`);
  const [adding, setAdding] = useState(false);
  const [making, setMaking] = useState(false);
  const [removing, setRemoving] = useState<Affected | null>(null);
  const [revising, setRevising] = useState<string | null>(null);
  const policiesOn = areaOn('policies') && can('policies.edit');

  const revise = async (a: Affected) => {
    setRevising(a.id);
    try {
      await startRevision(a.id, row);
      toast.success('Draft revision started. Edit it on the policy page.');
      navigate(`/policies/${a.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRevising(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/api/links/${removing.link_id}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card
      title="Affected records"
      flush
      actions={rec.canEdit && (
        <>
          {can('obligations.create') && <Button size="sm" icon="plus" onClick={() => setMaking(true)}>Make an obligation</Button>}
          <Button size="sm" icon="link" onClick={() => setAdding(true)}>Add affected record</Button>
        </>
      )}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rk-panel-pad"><Loading lines={3} label="Loading affected records" /></div>
        : data.length === 0 ? (
          <EmptyState icon="link" title="No affected records yet" message="Name the policies, obligations and controls this change affects, or make a new obligation from it." />
        ) : (
          <TableWrap label="Records this change affects">
            <table className="table">
              <caption className="sr-only">Records this change affects</caption>
              <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col" aria-label="Actions" /></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.link_id}>
                    <td><Link to={a.route}>{a.ref && <span className="ref">{a.ref}</span>} {a.label}</Link></td>
                    <td>{a.type_label}</td>
                    <td>{a.status ? <span>{a.status.replace(/_/g, ' ')}</span> : <span className="muted">—</span>}</td>
                    <td>
                      <span className="row">
                        {a.type === 'policy' && policiesOn && rec.canEdit && (
                          <Button size="sm" loading={revising === a.id} onClick={() => void revise(a)}>Start revision</Button>
                        )}
                        {rec.canEdit && <IconButton icon="x" size="sm" label={`Remove ${a.label ?? 'link'}`} onClick={() => setRemoving(a)} />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && <AffectDialog changeId={row.id} onClose={() => setAdding(false)} onDone={reload} />}
      {making && <ObligationDialog change={row} onClose={() => setMaking(false)} onDone={reload} />}
      <ConfirmDialog
        open={removing !== null}
        title="Remove affected record"
        message={`Stop listing ${removing?.ref ?? ''} ${removing?.label ?? ''} as affected by this change? The record itself is not changed.`}
        confirmLabel="Remove"
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

export function RegulatoryChangeDetail() {
  return (
    <RecordPage
      type="regulatory_change"
      subtitle={(row) => [row.citation, row.issuer].filter(Boolean).join(' · ')}
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div><span className="rk-step-label">Impact</span><LookupChip list="regulatory_impact" value={row.impact_level} /></div>
          <div><span className="rk-step-label">Published</span><span>{row.published_on ? formatDate(row.published_on) : <span className="muted">Not set</span>}</span></div>
          <div>
            <span className="rk-step-label">Takes effect</span>
            <span className="row">
              <strong>{row.effective_on ? formatDate(row.effective_on) : 'Not set'}</strong>
              {row.effective_on && !['implemented', 'not_applicable'].includes(row.status) && <DueChip date={row.effective_on} warnDays={60} overdueWord="In effect for" />}
            </span>
          </div>
          <div><span className="rk-step-label">Owner</span><span>{row._display?.owner_id ?? <span className="muted">No owner</span>}</span></div>
        </div>
      )}
      summaryFields={['title', 'issuer', 'citation', 'published_on', 'effective_on', 'summary', 'impact_level', 'impact_assessment', 'status', 'owner_id']}
      tabs={[
        {
          key: 'impact', label: 'Impact and actions',
          content: (rec) => (
            <div className="stack">
              <AffectedPanel rec={rec} />
              <ActionsPanel sourceType="regulatory_change" sourceId={rec.row.id} source="regulatory_change" />
            </div>
          ),
        },
      ]}
    />
  );
}
