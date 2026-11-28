// Solicitations: the list with the area's figures, and one solicitation with its offers, evaluation and
// award, schedule and addenda, required clauses, protests and purchase orders.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, LookupChip,
  LookupSelect, Modal, Notice, NumberField, PageHeader, RecordPage, RecordPicker, ResourceList, Select, TableWrap, TextArea, TextField,
  todayInZone, useAuth, useFetch, useToast, UserPicker, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, Row } from '../../core';
import { money, SummaryTiles, type Summary } from './shared';

const COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'method', priority: 2 }, 'status', { field: 'estimated_value', priority: 2 }, { field: 'proposals_due_at', priority: 2 },
  { field: 'buyer_id', priority: 3 }, { field: 'department_id', priority: 3 }, { field: 'awarded_on', hidden: true }, { field: 'award_amount', hidden: true },
  { field: 'funding_award_id', hidden: true }, { field: 'solicitation_type', hidden: true },
];
const FILTERS = ['status', 'method', 'solicitation_type', 'buyer_id', 'department_id', 'funding_award_id', 'proposals_due_at', 'awarded_on'];
const CREATE = ['title', 'description', 'method', 'solicitation_type', 'estimated_value', 'independent_estimate', 'independent_estimate_on', 'funding_award_id',
  'department_id', 'buyer_id', 'document_id', 'issued_on', 'questions_due_on', 'proposals_due_at', 'award_planned_on', 'justification', 'notes'];
const SUMMARY = ['title', 'description', 'method', 'solicitation_type', 'estimated_value', 'independent_estimate', 'independent_estimate_on', 'funding_award_id',
  'department_id', 'buyer_id', 'document_id', 'issued_on', 'questions_due_on', 'proposals_due_at', 'award_planned_on', 'justification', 'contract_id', 'notes'];

export function SolicitationList() {
  const { data: s } = useFetch<Summary>('/api/procurement/summary');
  return (
    <div className="stack">
      <PageHeader title="Procurement" subtitle="Solicitations from planning to award, the purchase orders that follow, and the budgets they are charged to." />
      {s ? <SummaryTiles s={s} /> : <Loading lines={2} label="Loading the figures" />}
      <ResourceList type="procurement" urlState columns={COLUMNS} filters={FILTERS} createFields={CREATE} />
    </div>
  );
}

// ---------- offers ----------

function Offers({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const { data, error, reload } = useFetch<{ total: number; responsive: number; hidden: number }>(`/api/procurements/${row.id}/offers-summary`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const closed = Boolean(row.awarded_on) || ['canceled', 'closed'].includes(String(row.status));
  return (
    <div className="stack">
      {data.hidden > 0 && (
        <Notice title={`${data.total} offer${data.total === 1 ? '' : 's'} received`}>
          Offers and their prices are read by procurement staff and the evaluation committee until the award. {data.hidden === data.total ? 'You will see them once it is recorded.' : `${data.hidden} of them are hidden from you until then.`}
        </Notice>
      )}
      {data.hidden < data.total || data.total === 0 ? (
        <ResourceList
          type="procurement_offer"
          baseFilter={{ procurement_id: String(row.id) }}
          columns={['ref', 'bidder_name', { field: 'vendor_id', priority: 3 }, 'received_at', 'amount', 'status']}
          filters={['status']}
          createFields={canEdit && !closed ? ['vendor_id', 'bidder_name', 'received_at', 'amount', 'status', 'notes'] : undefined}
          createInitial={{ procurement_id: row.id }}
          onCreated={() => reload()}
        />
      ) : null}
    </div>
  );
}

// ---------- evaluation and award ----------

interface Criterion { id?: string; name: string; description?: string | null; weight: number; max_score: number }
interface Evaluator { id: string; user_id: string; name: string | null; role: string; coi_status: string; coi_note: string | null; submitted_at: string | null; scores: number }
interface Ranked { offer_id: string; ref: string | null; bidder: string; amount: number | null; status: string | null; total: number | null; by_criterion: Record<string, number | null>; complete_by: number; rank: number | null; late: boolean }
interface Evaluation {
  evaluation: 'scored' | 'price' | 'none'; method: string; criteria: Criterion[]; counts: { offers: number; evaluators: number; submitted: number };
  awarded: boolean; restricted: boolean; evaluators: Evaluator[]; offers: Ranked[];
}

const COI: Record<string, string> = { pending: 'Not declared yet', none: 'No conflict', conflict: 'Conflict declared' };

function CriteriaEditor({ procId, current, onClose, onSaved }: { procId: string; current: Criterion[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Criterion[]>(current.length ? current.map((c) => ({ ...c, weight: Number(c.weight), max_score: Number(c.max_score) })) : []);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsavedChanges(dirty);
  const set = (i: number, patch: Partial<Criterion>) => { setDirty(true); setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const save = async (useTemplate = false) => {
    setBusy(true);
    try {
      await api.put(`/api/procurements/${procId}/criteria`, useTemplate ? { use_template: true } : { criteria: rows });
      unsaved.release();
      toast.success('Criteria saved.');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Evaluation criteria" size="lg" onClose={onClose} dirty={dirty}
      footer={<>
        <Button onClick={unsaved.guard(onClose)}>Cancel</Button>
        <Button loading={busy} onClick={() => save(true)}>Use the standard criteria</Button>
        <Button variant="primary" loading={busy} disabled={!rows.length} onClick={() => save(false)}>Save criteria</Button>
      </>}>
      <div className="stack">
        <p className="muted">Each offer is scored from 0 to the top score against each criterion; the weights decide how much each counts. Weights add up to {total}.</p>
        {rows.map((r, i) => (
          <div key={i} className="prc-criterion">
            <TextField label="Criterion" required value={r.name} onChange={(v) => set(i, { name: v })} />
            <NumberField label="Weight" required min={0} value={r.weight} onChange={(v) => set(i, { weight: v ?? 0 })} />
            <NumberField label="Top score" required min={1} value={r.max_score} onChange={(v) => set(i, { max_score: v ?? 10 })} />
            <Button variant="ghost" size="sm" icon="trash" aria-label={`Remove criterion ${r.name || i + 1}`} onClick={() => { setDirty(true); setRows((x) => x.filter((_, j) => j !== i)); }} />
          </div>
        ))}
        <div><Button size="sm" icon="plus" onClick={() => { setDirty(true); setRows((r) => [...r, { name: '', weight: 10, max_score: 10 }]); }}>Add a criterion</Button></div>
      </div>
    </Modal>
  );
}

function AddEvaluator({ procId, onClose, onSaved }: { procId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [user, setUser] = useState<string | null>(null);
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/procurements/${procId}/evaluators`, { user_id: user, role });
      toast.success('Added to the committee. They are notified.');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Add an evaluator" size="sm" onClose={onClose} dirty={Boolean(user)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!user} onClick={save}>Add</Button></>}>
      <div className="stack">
        <UserPicker label="Person" required value={user} onChange={(id) => setUser(id)} />
        <LookupSelect label="Role on the committee" list="evaluator_role" required value={role} onChange={setRole} />
        <p className="muted">They declare any conflict of interest and score each offer from their own page, without needing a procurement role.</p>
      </div>
    </Modal>
  );
}

function AwardDialog({ proc, offers, onClose, onSaved }: { proc: Row; offers: Ranked[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const ranked = offers.filter((o) => !['withdrawn', 'nonresponsive'].includes(String(o.status)));
  const [offer, setOffer] = useState(ranked.find((o) => o.rank === 1)?.offer_id ?? ranked[0]?.offer_id ?? '');
  const [reason, setReason] = useState('');
  const [on, setOn] = useState(todayInZone());
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.post(`/api/procurements/${proc.id}/award`, { offer_id: offer, reason, awarded_on: on, ...(amount !== null ? { amount } : {}) });
      toast.success('Award recorded.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title="Record the award" onClose={onClose} dirty={Boolean(reason)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!offer || !reason.trim()} onClick={save}>Record the award</Button></>}>
      <div className="stack">
        <Select label="Offer awarded" required value={offer} error={errors.offer_id} onChange={setOffer}
          options={ranked.map((o) => ({ value: o.offer_id, label: `${o.rank ? `${o.rank}. ` : ''}${o.bidder}${o.amount !== null ? ` · ${money(o.amount)}` : ''}${o.total !== null ? ` · ${o.total} points` : ''}` }))} />
        <TextArea label="Why this offer" required value={reason} error={errors.reason} rows={3} onChange={setReason}
          hint="The basis of the decision, for example the highest weighted score, or the lowest responsive bid." />
        <div className="prc-two">
          <DateField label="Awarded on" required value={on} error={errors.awarded_on} onChange={setOn} />
          <NumberField label="Award amount" value={amount} min={0} thousands placeholder="The offer's price" error={errors.amount} onChange={setAmount} />
        </div>
        <p className="muted">The other offers become "Not selected", and the offers and scores become readable by everyone who may view procurement.</p>
      </div>
    </Modal>
  );
}

function ContractCard({ proc, onSaved }: { proc: Row; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [linking, setLinking] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.post(`/api/procurements/${proc.id}/contract`, payload);
      toast.success('Contract linked.');
      setLinking(false); onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  if (!can('contracts.view')) return null;
  return (
    <Card title="Resulting contract">
      {proc.contract_id ? (
        <p><Link to={`/contracts/${proc.contract_id}`}>{String(proc._display?.contract_id ?? 'Open the contract')}</Link></p>
      ) : (
        <div className="stack">
          <p className="muted">Make a draft contract for the awarded vendor, or link a contract that already exists. The contract shows this solicitation under Related.</p>
          <div className="prc-buttons">
            {can('contracts.create') && <Button variant="primary" loading={busy} onClick={() => run({})}>Make the contract</Button>}
            <Button onClick={() => setLinking(true)}>Link an existing contract</Button>
          </div>
        </div>
      )}
      <Modal open={linking} title="Link the resulting contract" size="sm" onClose={() => setLinking(false)}
        footer={<><Button onClick={() => setLinking(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={() => run({ contract_id: pick })}>Link</Button></>}>
        <RecordPicker label="Contract" type="contract" required value={pick} onChange={(id) => setPick(id)} />
      </Modal>
    </Card>
  );
}

function EvaluationTab({ row, reload: reloadRecord }: { row: Row; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Evaluation>(`/api/procurements/${row.id}/evaluation`);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [removing, setRemoving] = useState<Evaluator | null>(null);
  const staff = can('procurement.edit');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  const open = !row.awarded_on && !['canceled', 'closed'].includes(String(row.status));
  const scored = data.evaluators.some((e) => e.scores > 0);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); }
  };
  const all = () => { reload(); reloadRecord(); };

  return (
    <div className="stack">
      {row.awarded_on && (
        <Card title="Award">
          <dl className="deflist">
            <div className="deflist-item"><dt>Awarded to</dt><dd>{String(row._display?.awarded_offer_id ?? '—')}</dd></div>
            <div className="deflist-item"><dt>Awarded on</dt><dd>{formatDate(row.awarded_on)}</dd></div>
            <div className="deflist-item"><dt>Amount</dt><dd>{money(row.award_amount)}</dd></div>
            <div className="deflist-item"><dt>Recorded by</dt><dd>{String(row.awarded_by_name ?? row._display?.awarded_by ?? '—')}</dd></div>
            <div className="deflist-item deflist-wide"><dt>Why this offer</dt><dd>{String(row.award_reason ?? '—')}</dd></div>
          </dl>
        </Card>
      )}
      {row.awarded_on && <ContractCard proc={row} onSaved={reloadRecord} />}

      <Card title="Criteria" actions={staff && open && data.evaluation === 'scored' && !scored && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>{data.criteria.length ? 'Change criteria' : 'Set criteria'}</Button>}>
        {data.evaluation !== 'scored' && <p className="muted">{data.method}: {data.evaluation === 'price' ? 'the lowest responsive price ranks first.' : 'no scored evaluation.'}</p>}
        {data.criteria.length === 0 ? (
          data.evaluation === 'scored' ? <EmptyState icon="scale" title="No criteria yet" message="Set the weighted criteria before the offers are scored, or start from the standard criteria." /> : null
        ) : (
          <TableWrap label="Evaluation criteria"><table className="table prc-wrap">
            <thead><tr><th scope="col">Criterion</th><th scope="col" className="num">Weight</th><th scope="col" className="num">Top score</th></tr></thead>
            <tbody>{data.criteria.map((c) => <tr key={c.id ?? c.name}><td>{c.name}{c.description && <div className="muted prc-small">{c.description}</div>}</td><td className="num">{Number(c.weight)}</td><td className="num">{Number(c.max_score)}</td></tr>)}</tbody>
          </table></TableWrap>
        )}
      </Card>

      {data.restricted ? (
        <Notice title="Evaluation in progress">
          {data.counts.offers} offer{data.counts.offers === 1 ? '' : 's'} received; {data.counts.submitted} of {data.counts.evaluators} evaluator{data.counts.evaluators === 1 ? ' has' : 's have'} handed in scores.
          The committee, the scores and the ranking are read by procurement staff and the committee until the award.
        </Notice>
      ) : (
        <>
          {(data.evaluation === 'scored' || data.evaluators.length > 0) && <Card title="Evaluation committee" flush actions={staff && open && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add an evaluator</Button>}>
            {data.evaluators.length === 0 ? <EmptyState icon="users" title="No evaluators yet" message="Add the people who score the offers. Each declares any conflict of interest first." /> : (
              <TableWrap label="Evaluation committee"><table className="table prc-wrap">
                <thead><tr><th scope="col">Evaluator</th><th scope="col">Role</th><th scope="col">Conflict of interest</th><th scope="col">Scores</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{data.evaluators.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name ?? 'A former account'}</td>
                    <td><LookupChip list="evaluator_role" value={e.role} /></td>
                    <td>{COI[e.coi_status] ?? e.coi_status}{e.coi_note && <div className="muted prc-small">{e.coi_note}</div>}</td>
                    <td>{e.submitted_at ? `Handed in ${formatDate(e.submitted_at)}` : e.scores ? `${e.scores} saved` : 'None yet'}</td>
                    <td className="prc-actions">
                      {staff && open && e.submitted_at && <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/api/procurements/${row.id}/evaluators/${e.id}`, { reopen: true }), 'Scores reopened.')}>Reopen</Button>}
                      {staff && open && !e.scores && <Button size="sm" variant="ghost" aria-label={`Remove ${e.name ?? 'evaluator'}`} onClick={() => setRemoving(e)}>Remove</Button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></TableWrap>
            )}
          </Card>}
          <Card title={data.evaluation === 'price' ? 'Offers by price' : 'Ranked offers'} flush
            actions={can('procurement.approve') && open && data.offers.length > 0 && <Button size="sm" variant="primary" onClick={() => setAwarding(true)}>Record the award</Button>}>
            {data.offers.length === 0 ? <EmptyState icon="folder" title="No offers yet" message="Record the offers received on the Offers tab." /> : (
              <TableWrap label="Ranked offers" fit><table className="table">
                <thead><tr>
                  <th scope="col" data-priority={1}>Rank</th><th scope="col" data-priority={1}>Bidder</th><th scope="col" className="num" data-priority={1}>Price</th>
                  {data.evaluation === 'scored' && <th scope="col" className="num" data-priority={1}>Score (of 100)</th>}
                  {data.evaluation === 'scored' && data.criteria.map((c) => <th key={c.id} scope="col" className="num" data-priority={3}>{c.name}</th>)}
                  <th scope="col" data-priority={2}>Status</th>
                </tr></thead>
                <tbody>{[...data.offers].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map((o) => (
                  <tr key={o.offer_id}>
                    <td>{o.rank ?? '—'}</td>
                    <td><Link to={`/procurement/offers/${o.offer_id}`}>{o.ref && <span className="ref">{o.ref}</span>} {o.bidder}</Link>{o.late && <span className="chip chip-amber prc-late">Late</span>}</td>
                    <td className="num">{money(o.amount)}</td>
                    {data.evaluation === 'scored' && <td className="num">{o.total ?? '—'}</td>}
                    {data.evaluation === 'scored' && data.criteria.map((c) => <td key={c.id} className="num">{o.by_criterion[c.id!] ?? '—'}</td>)}
                    <td>{o.status ? <LookupChip list="offer_status" value={o.status} /> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table></TableWrap>
            )}
          </Card>
        </>
      )}
      {editing && <CriteriaEditor procId={String(row.id)} current={data.criteria} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {adding && <AddEvaluator procId={String(row.id)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {awarding && <AwardDialog proc={row} offers={data.offers} onClose={() => setAwarding(false)} onSaved={() => { setAwarding(false); all(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this evaluator?" message={`${removing?.name ?? 'The evaluator'} will no longer be on the committee.`} confirmLabel="Remove" danger
        onConfirm={() => { const e = removing!; setRemoving(null); act(() => api.del(`/api/procurements/${row.id}/evaluators/${e.id}`), 'Evaluator removed.'); }} onCancel={() => setRemoving(null)} />
    </div>
  );
}

// ---------- addenda ----------

interface Addendum { id: string; number: number; issued_on: string; summary: string; document_id: string | null }

function Addenda({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Addendum[]>(`/api/procurements/${row.id}/addenda`);
  const [adding, setAdding] = useState(false);
  const [on, setOn] = useState(todayInZone());
  const [summary, setSummary] = useState('');
  const [doc, setDoc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/procurements/${row.id}/addenda`, { issued_on: on, summary, document_id: doc });
      toast.success('Addendum recorded.'); setAdding(false); setSummary(''); setDoc(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Addenda" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Record an addendum</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="prc-pad"><Loading lines={2} /></div>
        : data.length === 0 ? <EmptyState icon="file-text" title="No addenda" message="Changes to the solicitation after it is issued are recorded here, numbered in order." /> : (
          <TableWrap label="Addenda"><table className="table prc-wrap">
            <thead><tr><th scope="col">No.</th><th scope="col">Issued</th><th scope="col">What it changes</th><th scope="col">Document</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}><td>{a.number}</td><td>{formatDate(a.issued_on)}</td><td>{a.summary}</td>
                <td>{a.document_id ? <Link to={`/policies/${a.document_id}`}>Open</Link> : '—'}</td></tr>
            ))}</tbody>
          </table></TableWrap>
        )}
      <Modal open={adding} title="Record an addendum" size="sm" onClose={() => setAdding(false)} dirty={Boolean(summary)}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!summary.trim()} onClick={save}>Record</Button></>}>
        <div className="stack">
          <DateField label="Issued on" required value={on} onChange={setOn} />
          <TextArea label="What it changes" required value={summary} rows={3} onChange={setSummary} />
          <RecordPicker label="Document (optional)" type="policy" value={doc} onChange={(id) => setDoc(id)} />
        </div>
      </Modal>
    </Card>
  );
}

function Schedule({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const steps: [string, unknown, boolean][] = [
    ['Issued', row.issued_on, false], ['Questions due', row.questions_due_on, false], ['Offers due', row.proposals_due_at, true],
    ['Planned award', row.award_planned_on, false], ['Awarded', row.awarded_on, false],
  ];
  return (
    <div className="stack">
      <Card title="Schedule">
        <dl className="deflist">{steps.map(([label, v, time]) => (
          <div key={label} className="deflist-item"><dt>{label}</dt><dd>{v ? (time ? formatDateTime(String(v)) : formatDate(String(v))) : '—'}</dd></div>
        ))}</dl>
      </Card>
      <Addenda row={row} canEdit={canEdit} />
    </div>
  );
}

// ---------- required clauses ----------

interface Clause { clause_key: string; label: string; description: string | null; status: string | null; note: string | null }

function Clauses({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Clause[]>(`/api/procurements/${row.id}/clauses`);
  const save = async (c: Clause, status: string) => {
    try { await api.put(`/api/procurements/${row.id}/clauses`, { checks: [{ clause_key: c.clause_key, status: status || null }] }); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const done = data.filter((c) => c.status).length;
  return (
    <Card title="Required clauses" flush>
      <p className="muted prc-pad">The organization's clause template (Lists &gt; Procurement required clause): {done} of {data.length} checked for the solicitation and the resulting contract.</p>
      {data.length === 0 ? <EmptyState icon="check-square" title="No required clauses" message="Add the clauses your contracts must carry under Procurement settings." /> : (
        <TableWrap label="Required clauses"><table className="table prc-wrap">
          <thead><tr><th scope="col">Clause</th><th scope="col">Status</th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.clause_key}>
              <td>{c.label}{c.description && <div className="muted prc-small">{c.description}</div>}</td>
              <td className="prc-clause-status">{canEdit
                ? <LookupSelect label={`Status of ${c.label}`} hideLabel list="procurement_clause_status" value={c.status ?? ''} placeholder="Not checked" onChange={(v) => save(c, v)} />
                : c.status ? <LookupChip list="procurement_clause_status" value={c.status} /> : 'Not checked'}</td>
            </tr>
          ))}</tbody>
        </table></TableWrap>
      )}
    </Card>
  );
}

// ---------- protests ----------

interface Protest { id: string; protester: string; received_on: string; grounds: string | null; status: string; decided_on: string | null; decision: string | null; decided_by_name: string | null }

function Protests({ row, canEdit }: { row: Row; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Protest[]>(`/api/procurements/${row.id}/protests`);
  const [editing, setEditing] = useState<Protest | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const open = (p: Protest | 'new') => { setEditing(p); setForm(p === 'new' ? { received_on: todayInZone(), status: 'received' } : { status: p.status, decision: p.decision ?? '', decided_on: p.decided_on ?? '' }); };
  const save = async () => {
    setBusy(true);
    try {
      if (editing === 'new') await api.post(`/api/procurements/${row.id}/protests`, form);
      else await api.patch(`/api/procurements/${row.id}/protests/${(editing as Protest).id}`, { ...form, decided_on: form.decided_on || undefined });
      toast.success('Protest saved.'); setEditing(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Protests" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => open('new')}>Record a protest</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="prc-pad"><Loading lines={2} /></div>
        : data.length === 0 ? <EmptyState icon="scale" title="No protests" message="A protest by a bidder is recorded here with its decision." /> : (
          <TableWrap label="Protests"><table className="table prc-wrap">
            <thead><tr><th scope="col">Protester</th><th scope="col">Received</th><th scope="col">Grounds</th><th scope="col">Status</th><th scope="col">Decision</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}>
                <td>{p.protester}</td><td>{formatDate(p.received_on)}</td><td>{p.grounds ?? '—'}</td>
                <td><LookupChip list="protest_status" value={p.status} /></td>
                <td>{p.decision ? <>{p.decision}<div className="muted prc-small">{[p.decided_on && formatDate(p.decided_on), p.decided_by_name].filter(Boolean).join(' · ')}</div></> : '—'}</td>
                <td>{canEdit && <Button size="sm" variant="ghost" aria-label={`Update the protest by ${p.protester}`} onClick={() => open(p)}>Update</Button>}</td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Record a protest' : 'Update the protest'} size="sm" onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="stack">
          {editing === 'new' && <>
            <TextField label="Protester" required value={String(form.protester ?? '')} onChange={(v) => setForm({ ...form, protester: v })} />
            <RecordPicker label="Vendor (optional)" type="vendor" value={(form.vendor_id as string) ?? null} onChange={(id) => setForm({ ...form, vendor_id: id })} />
            <DateField label="Received on" required value={String(form.received_on ?? '')} onChange={(v) => setForm({ ...form, received_on: v })} />
            <TextArea label="Grounds" value={String(form.grounds ?? '')} rows={3} onChange={(v) => setForm({ ...form, grounds: v })} />
          </>}
          <LookupSelect label="Status" list="protest_status" required value={String(form.status ?? 'received')} onChange={(v) => setForm({ ...form, status: v })} />
          {editing !== 'new' && <>
            <TextArea label="Decision" value={String(form.decision ?? '')} rows={3} onChange={(v) => setForm({ ...form, decision: v })} />
            <DateField label="Decided on" value={String(form.decided_on ?? '')} onChange={(v) => setForm({ ...form, decided_on: v })} />
          </>}
        </div>
      </Modal>
    </Card>
  );
}

// ---------- the record page ----------

export function SolicitationDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="procurement"
      summaryFields={SUMMARY}
      tabs={[
        { key: 'offers', label: 'Offers', content: ({ row, canEdit }) => <Offers row={row} canEdit={canEdit} /> },
        { key: 'evaluation', label: 'Evaluation and award', content: ({ row, reload }) => <EvaluationTab row={row} reload={reload} /> },
        { key: 'schedule', label: 'Schedule and addenda', content: ({ row, canEdit }) => <Schedule row={row} canEdit={canEdit} /> },
        { key: 'clauses', label: 'Required clauses', content: ({ row, canEdit }) => <Clauses row={row} canEdit={canEdit} /> },
        { key: 'protests', label: 'Protests', content: ({ row, canEdit }) => <Protests row={row} canEdit={canEdit} /> },
        ...(can('procurement.view') ? [{
          key: 'orders', label: 'Purchase orders', content: ({ row }: { row: Row }) => (
            <ResourceList type="purchase_order" baseFilter={{ procurement_id: String(row.id) }} columns={['ref', 'title', 'vendor_name', 'order_date', 'status', 'total']}
              createFields={['title', 'vendor_id', 'vendor_name', 'budget_line_id', 'contract_id', 'needed_by', 'notes']} createInitial={{ procurement_id: row.id, contract_id: row.contract_id ?? undefined }} />
          ),
        }] : []),
      ]}
    />
  );
}

export function OfferDetail() {
  return (
    <RecordPage
      type="procurement_offer"
      summaryFields={['procurement_id', 'vendor_id', 'bidder_name', 'received_at', 'amount', 'status', 'notes']}
    />
  );
}

export function OfferList() {
  return (
    <div className="stack">
      <PageHeader title="Offers" subtitle="Offers received on every solicitation. Before the award, only procurement staff and the evaluation committee read them." />
      <ResourceList type="procurement_offer" urlState columns={['ref', 'bidder_name', 'procurement_id', 'received_at', 'amount', 'status']} filters={['procurement_id', 'status', 'vendor_id']} />
    </div>
  );
}
