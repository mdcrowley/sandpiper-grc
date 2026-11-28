// The insurance pages: policies (figures, list and the policy page with its conditions, covered records,
// claims and Renew), certificates of insurance and the contract requirements they are checked against,
// claims, the renewal calendar and the settings.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, currency, EmptyState, ErrorState, errorMessage, formatCurrency, formatDate, Loading, LookupChip, Modal,
  Notice, PageHeader, RecordPage, RecordPicker, ResourceList, Select, Stat, TableWrap, TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, RecordContext, Row } from '../../core';

interface Summary {
  today: string; expiring_days: number;
  policies: { in_force: number; expiring: number; lapsed: number; applications_overdue: number; premium: number };
  certificates: { expired: number; expiring: number; short: number; requirements_unmet: number };
  claims: { open: number; open_reserves: number; paid: number; recovered: number };
  conditions: { not_met: number };
}

/** Money on a figure tile: compact ("$1.2M"); lists and records use formatCurrency. */
function compactMoney(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency(), notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return formatCurrency(n);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function useSummary() {
  return useFetch<Summary>('/api/insurance/summary');
}

// ---------- policies ----------

const POLICY_COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'line', priority: 1 }, 'status', { field: 'expires_on', priority: 1 }, { field: 'renewal_status', priority: 2 },
  { field: 'insurer_name', priority: 3 }, { field: 'premium', priority: 3 }, { field: 'limit_per_occurrence', priority: 3 }, { field: 'owner_id', priority: 3 },
  { field: 'policy_number', hidden: true }, { field: 'deductible', hidden: true }, { field: 'renewal_application_due', hidden: true },
];
const POLICY_FILTERS = ['line', 'status', 'renewal_status', 'insurer_kind', 'insurer_id', 'owner_id', 'department_id', 'expires_on', 'renewal_application_due'];
const POLICY_CREATE = [
  'title', 'line', 'status', 'insurer_kind', 'insurer_id', 'insurer_name', 'broker_name', 'policy_number', 'effective_on', 'expires_on', 'premium',
  'limit_per_occurrence', 'limit_aggregate', 'deductible', 'retention', 'sublimits', 'named_insureds', 'owner_id', 'department_id',
  'renewal_status', 'renewal_application_due', 'notes',
];

function PolicyFigures({ s }: { s: Summary }) {
  const soon = new Date(`${s.today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + s.expiring_days);
  const until = soon.toISOString().slice(0, 10);
  return (
    <div className="grid-stats">
      <Stat label="Policies in force" value={s.policies.in_force} icon="shield" hint={`${compactMoney(s.policies.premium)} premium a term`} to="/insurance?f.status=active" />
      <Stat label="Expiring soon" value={s.policies.expiring} icon="clock" color={s.policies.expiring ? 'amber' : undefined} hint={`Within ${s.expiring_days} days`}
        to={`/insurance?f.status=draft,active&f.expires_on.gt=${s.today}&f.expires_on.lt=${until}`} />
      <Stat label="Renewal applications overdue" value={s.policies.applications_overdue} icon="alert" color={s.policies.applications_overdue ? 'red' : undefined}
        hint="Not yet submitted" to="/insurance/renewals" />
      <Stat label="Conditions not met" value={s.conditions.not_met} icon="check-square" color={s.conditions.not_met ? 'red' : undefined} hint="Not met or partly met, on current policies" />
    </div>
  );
}

export function PolicyList() {
  const { data: s, error } = useSummary();
  return (
    <div className="stack">
      <PageHeader title="Insurance" subtitle="The organization's insurance program: policies with their limits, conditions, covered records and renewals." />
      {s ? <PolicyFigures s={s} /> : error ? null : <Loading lines={2} label="Loading the figures" />}
      <ResourceList type="insurance_policy" urlState columns={POLICY_COLUMNS} filters={POLICY_FILTERS} createFields={POLICY_CREATE} />
    </div>
  );
}

interface ConditionRow {
  id: string; title: string; status: string; due_on: string | null; control_id: string | null;
  control: { id: string; ref: string; title: string; operating_rating: string | null; last_tested_on: string | null; next_test_due: string | null; state: string } | null;
  control_hidden: boolean;
}
const CONTROL_STATE: Record<string, { label: string; tone: string }> = {
  effective: { label: 'Effective', tone: 'ins-good' },
  partly_effective: { label: 'Partly effective', tone: 'ins-warn' },
  ineffective: { label: 'Ineffective', tone: 'ins-bad' },
  not_tested: { label: 'Not tested yet', tone: 'muted' },
  test_overdue: { label: 'Test overdue', tone: 'ins-bad' },
};

function Conditions({ row, canEdit }: RecordContext) {
  const { data, error, reload } = useFetch<{ rows: ConditionRow[] }>(`/api/insurance/policies/${row.id}/conditions`);
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <Card title="What the policy requires" flush actions={canEdit ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add condition</Button> : undefined}>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="ins-pad"><Loading lines={3} /></div>
          : data.rows.length === 0 ? (
            <EmptyState icon="check-square" title="No conditions recorded" message="Record the conditions and warranties the policy sets (for a cyber policy, its security requirements), each tracked by a control where there is one." />
          ) : (
            <TableWrap label="Policy conditions" fit>
              <table className="table">
                <caption className="sr-only">Policy conditions</caption>
                <thead><tr><th scope="col">Condition</th><th scope="col">Assessment</th><th scope="col">Tracked by control</th><th scope="col" data-priority="2">Control result</th><th scope="col" data-priority="3">Must be met by</th></tr></thead>
                <tbody>
                  {data.rows.map((c) => {
                    const st = c.control ? CONTROL_STATE[c.control.state] ?? { label: c.control.state, tone: '' } : null;
                    return (
                      <tr key={c.id}>
                        <td><Link className="row-title" to={`/insurance/conditions/${c.id}`}>{c.title}</Link></td>
                        <td><LookupChip list="insurance_condition_status" value={c.status} /></td>
                        <td>{c.control ? <Link to={`/controls/${c.control.id}`}><span className="ref">{c.control.ref}</span> {c.control.title}</Link>
                          : c.control_hidden ? <span className="muted">A control you cannot open</span> : <span className="muted">None</span>}</td>
                        <td data-priority="2">{st ? <span className={st.tone}>{st.label}</span> : <span className="muted">—</span>}
                          {c.control?.last_tested_on && <span className="muted ins-small ins-block">Tested {formatDate(c.control.last_tested_on)}</span>}</td>
                        <td data-priority="3">{c.due_on ? formatDate(c.due_on) : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      {adding && (
        <Modal open title="Add a condition" onClose={() => setAdding(false)}>
          <ConditionForm policyId={String(row.id)} onDone={() => { setAdding(false); reload(); }} />
        </Modal>
      )}
    </div>
  );
}

function ConditionForm({ policyId, onDone }: { policyId: string; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [control, setControl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { can, areaOn } = useAuth();
  const dirty = Boolean(title || control);
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/insurance/conditions', { policy_id: policyId, title, control_id: control });
      unsaved.release();
      toast.success('Condition added.');
      onDone();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <TextField label="Condition" required value={title} onChange={setTitle} error={errors.title} hint='For example "Second factor on all remote access".' />
      {areaOn('controls') && can('controls.view') && (
        <RecordPicker label="Tracked by control" type="control" value={control} onChange={(id) => setControl(id)} error={errors.control_id}
          hint="The control's test results then show whether the condition is met." />
      )}
      <div className="form-actions">
        <Button type="button" onClick={unsaved.guard(onDone)}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Add condition</Button>
      </div>
    </form>
  );
}

interface CoveredRow { id: string; record_type: string; type_label: string; record_id: string; ref: string | null; label: string; route: string; note: string | null }

function Covered({ row, canEdit }: RecordContext) {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ rows: CoveredRow[]; hidden: number; types: { type: string; label: string }[] }>(`/api/insurance/policies/${row.id}/covered`);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<CoveredRow | null>(null);
  const kind = type || data?.types[0]?.type || '';
  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(`/api/insurance/policies/${row.id}/covered`, { record_type: kind, record_id: pick, note: note || null });
      toast.success('Added to what the policy covers.');
      setAdding(false); setPick(null); setNote(''); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/insurance/policies/${row.id}/covered/${removing.id}`);
      toast.success('Taken off the policy.'); setRemoving(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Covered records" flush actions={canEdit && data?.types.length ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add record</Button> : undefined}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="ins-pad"><Loading lines={3} /></div>
        : data.rows.length === 0 && !data.hidden ? <EmptyState icon="box" title="No covered records listed" message="List the assets, vehicles, sites and systems the policy covers, so each shows its insurance." />
        : (
          <>
            {data.rows.length > 0 && (
              <TableWrap label="Records the policy covers">
                <table className="table">
                  <caption className="sr-only">Records the policy covers</caption>
                  <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">Note</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td><Link className="row-title" to={r.route}>{r.ref && <span className="ref">{r.ref}</span>} {r.label}</Link></td>
                        <td>{r.type_label}</td>
                        <td>{r.note ?? <span className="muted">—</span>}</td>
                        {canEdit && <td className="ins-actions"><Button size="sm" variant="ghost" aria-label={`Take off the policy: ${r.label}`} onClick={() => setRemoving(r)}>Remove</Button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {data.hidden > 0 && <p className="muted ins-pad ins-small">Also covers {plural(data.hidden, 'record')} you cannot open.</p>}
          </>
        )}
      {adding && data && (
        <Modal open title="Add a covered record" size="sm" onClose={() => setAdding(false)} dirty={Boolean(pick || note)}
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={() => void add()}>Add</Button></>}>
          <div className="stack">
            <Select label="Kind of record" required value={kind} options={data.types.map((t) => ({ value: t.type, label: t.label }))} onChange={(v) => { setType(v); setPick(null); }} />
            <RecordPicker key={kind} label={data.types.find((t) => t.type === kind)?.label ?? 'Record'} type={kind} required value={pick} onChange={(id) => setPick(id)} />
            <TextField label="Note" value={note} onChange={setNote} hint='For example "Buildings and contents" or "Physical damage only".' />
          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!removing} title="Take this record off the policy?" message={`${removing?.label ?? 'The record'} will no longer be listed as covered by this policy.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function PolicyClaims({ row }: RecordContext) {
  const { can } = useAuth();
  return (
    <ResourceList type="insurance_claim" baseFilter={{ policy_id: String(row.id) }} columns={['ref', 'title', 'claim_kind', 'status', 'incident_on', 'reserve', 'paid']}
      filters={['status', 'claim_kind']} createFields={can('insurance.create') ? CLAIM_CREATE : undefined} createInitial={{ policy_id: row.id }} onCreated={() => undefined} />
  );
}

function RenewButton({ row }: RecordContext) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!can('insurance.create') || !['draft', 'active'].includes(String(row.status))) return null;
  const renew = async () => {
    setBusy(true);
    try {
      const made = await api.post<Row>(`/api/insurance/policies/${row.id}/renew`, {});
      toast.success(`Next term started as ${made.ref}.`);
      navigate(`/insurance/${made.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setAsking(false); }
  };
  return (
    <>
      <Button variant="primary" icon="refresh" onClick={() => setAsking(true)}>Renew</Button>
      <ConfirmDialog open={asking} title="Start the next term?" confirmLabel="Start next term" busy={busy} onConfirm={() => void renew()} onCancel={() => setAsking(false)}
        message="A new policy is made for the next term, being placed, with the same coverage, conditions and covered records. Set it to In force once it is bound: this policy then shows as Renewed." />
    </>
  );
}

export function PolicyDetail() {
  return (
    <RecordPage
      type="insurance_policy"
      actions={(rec) => <RenewButton {...rec} />}
      summaryFields={POLICY_CREATE.concat(['replaces_id'])}
      tabs={[
        { key: 'conditions', label: 'Conditions', content: (rec) => <Conditions {...rec} /> },
        { key: 'covered', label: 'Covered records', content: (rec) => <Covered {...rec} /> },
        { key: 'claims', label: 'Claims', content: (rec) => <PolicyClaims {...rec} /> },
      ]}
    />
  );
}

export function ConditionDetail() {
  return (
    <RecordPage
      type="insurance_condition"
      summaryFields={['title', 'policy_id', 'description', 'control_id', 'status', 'due_on', 'owner_id', 'notes']}
      breadcrumbs={[{ label: 'Insurance', to: '/insurance' }, { label: 'Policy condition' }]}
    />
  );
}

// ---------- certificates and contract requirements ----------

const CERT_COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'vendor_id', priority: 2 }, { field: 'line', priority: 2 }, 'status', { field: 'check_result', priority: 1 }, { field: 'expires_on', priority: 1 },
  { field: 'contract_id', priority: 3 }, { field: 'limit_per_occurrence', priority: 3 }, { field: 'owner_id', priority: 3 }, { field: 'check_notes', hidden: true },
];
const CERT_FILTERS = ['vendor_id', 'contract_id', 'line', 'status', 'check_result', 'owner_id', 'expires_on', 'additional_insured'];
const CERT_CREATE = [
  'vendor_id', 'contract_id', 'insured_name', 'line', 'insurer_name', 'policy_number', 'effective_on', 'expires_on', 'limit_per_occurrence', 'limit_aggregate',
  'additional_insured', 'waiver_of_subrogation', 'received_on', 'status', 'owner_id', 'title', 'notes',
];

export function CertificateList() {
  const { data: s, error } = useSummary();
  return (
    <div className="stack">
      <PageHeader title="Certificates of insurance" subtitle="Certificates received from vendors and contractors, each checked against the insurance its contract requires." />
      {s ? (
        <div className="grid-stats">
          <Stat label="Expired" value={s.certificates.expired} icon="alert" color={s.certificates.expired ? 'red' : undefined} hint="Still on file, coverage ended"
            to={`/insurance/certificates?f.status=received,accepted&f.expires_on.lt=${s.today}`} />
          <Stat label="Expire within 30 days" value={s.certificates.expiring} icon="clock" color={s.certificates.expiring ? 'amber' : undefined} hint="Ask for a current certificate" to="/insurance/renewals" />
          <Stat label="Short of the contract" value={s.certificates.short} icon="scale" color={s.certificates.short ? 'red' : undefined} hint="Limits or terms below the requirement"
            to="/insurance/certificates?f.check_result=short" />
          <Stat label="Contract requirements not met" value={s.certificates.requirements_unmet} icon="file-text" color={s.certificates.requirements_unmet ? 'amber' : undefined}
            hint="Missing, expired or short" to="/insurance/requirements?f.state=missing,expired,short" />
        </div>
      ) : error ? null : <Loading lines={2} label="Loading the figures" />}
      <ResourceList type="insurance_certificate" urlState columns={CERT_COLUMNS} filters={CERT_FILTERS} createFields={CERT_CREATE} />
    </div>
  );
}

interface CheckAnswer {
  requirements: { id: string; title: string; line: string; min_per_occurrence: number | null; min_aggregate: number | null; additional_insured: boolean; waiver_of_subrogation: boolean; state: string | null; state_notes: string | null }[];
}

function ContractCheck({ row }: RecordContext) {
  const { data, error, reload } = useFetch<CheckAnswer>(row.contract_id ? `/api/insurance/contracts/${row.contract_id}/check` : null);
  if (!row.contract_id) {
    return <Card title="What the contract requires"><p className="muted">Choose the contract this certificate answers to check it against the contract&apos;s insurance requirements.</p></Card>;
  }
  return (
    <Card title="What the contract requires" flush>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="ins-pad"><Loading lines={3} /></div>
        : data.requirements.length === 0 ? (
          <EmptyState icon="scale" title="No insurance requirements recorded for this contract" message="Add the lines of coverage and minimum limits the contract requires under Contract requirements." />
        ) : (
          <TableWrap label="Insurance the contract requires" fit>
            <table className="table">
              <caption className="sr-only">Insurance the contract requires</caption>
              <thead><tr><th scope="col">Line</th><th scope="col">Minimum per occurrence</th><th scope="col" data-priority="2">Minimum aggregate</th><th scope="col">On file</th><th scope="col" data-priority="2">What is missing</th></tr></thead>
              <tbody>
                {data.requirements.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="row-title" to={`/insurance/requirements/${r.id}`}><LookupChip list="insurance_line" value={r.line} /></Link></td>
                    <td>{formatCurrency(r.min_per_occurrence)}</td>
                    <td data-priority="2">{formatCurrency(r.min_aggregate)}</td>
                    <td>{r.state ? <LookupChip list="insurance_requirement_state" value={r.state} /> : <span className="muted">—</span>}</td>
                    <td data-priority="2">{r.state_notes ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
    </Card>
  );
}

function CheckBanner({ row }: RecordContext) {
  if (row.check_result === 'short') return <Notice tone="warning" title="Short of the contract's requirement">{String(row.check_notes ?? '')}</Notice>;
  if (row.check_result === 'expired') return <Notice tone="warning" title="This certificate has expired">Ask the vendor for a current certificate and add it; this one is then superseded.</Notice>;
  return null;
}

export function CertificateDetail() {
  return (
    <RecordPage
      type="insurance_certificate"
      banner={(rec) => <CheckBanner {...rec} />}
      summaryFields={[...CERT_CREATE, 'check_result', 'check_notes']}
      tabs={[{ key: 'contract', label: 'Contract requirements', content: (rec) => <ContractCheck {...rec} /> }]}
    />
  );
}

export function RequirementList() {
  return (
    <div className="stack">
      <PageHeader title="Contract insurance requirements" subtitle="The insurance each contract requires of its vendor: one line of coverage per requirement, with minimum limits. Each shows whether a current certificate on file meets it." />
      <ResourceList
        type="insurance_requirement"
        urlState
        columns={['title', { field: 'contract_id', priority: 2 }, { field: 'line', priority: 2 }, { field: 'min_per_occurrence', priority: 3 }, { field: 'min_aggregate', priority: 3 }, { field: 'state', priority: 1 }, { field: 'state_notes', priority: 3 }]}
        filters={['contract_id', 'line', 'state', 'additional_insured']}
        createFields={['contract_id', 'line', 'min_per_occurrence', 'min_aggregate', 'additional_insured', 'waiver_of_subrogation', 'title', 'notes']}
      />
    </div>
  );
}

export function RequirementDetail() {
  return (
    <RecordPage
      type="insurance_requirement"
      status={(row) => (row.state ? <LookupChip list="insurance_requirement_state" value={String(row.state)} /> : null)}
      summaryFields={['title', 'contract_id', 'line', 'min_per_occurrence', 'min_aggregate', 'additional_insured', 'waiver_of_subrogation', 'state', 'state_notes', 'notes']}
      breadcrumbs={[{ label: 'Contract insurance requirements', to: '/insurance/requirements' }, { label: 'Requirement' }]}
    />
  );
}

// ---------- claims ----------

const CLAIM_CREATE = [
  'title', 'claim_kind', 'direction', 'policy_id', 'status', 'incident_on', 'reported_on', 'claimant_name', 'carrier_claim_number', 'adjuster_name', 'description',
  'safety_event_id', 'security_incident_id', 'asset_id', 'vehicle_id', 'site_id', 'reserve', 'paid', 'recovered', 'closed_on', 'owner_id', 'restricted', 'notes',
];

export function ClaimList() {
  const { data: s, error } = useSummary();
  return (
    <div className="stack">
      <PageHeader title="Insurance claims" subtitle="Claims under the organization's policies and against it, with reserves, payments and recoveries. Claims that hold personal or security details are restricted." />
      {s ? (
        <div className="grid-stats">
          <Stat label="Open claims" value={s.claims.open} icon="alert" to="/insurance/claims?f.status=open,investigating,litigation" />
          <Stat label="Reserves on open claims" value={compactMoney(s.claims.open_reserves)} icon="scale" hint="Set aside for open claims" />
          <Stat label="Paid" value={compactMoney(s.claims.paid)} icon="chart" hint="On every claim recorded" />
          <Stat label="Recovered" value={compactMoney(s.claims.recovered)} icon="refresh" hint="From insurers and other parties" />
        </div>
      ) : error ? null : <Loading lines={2} label="Loading the figures" />}
      <ResourceList
        type="insurance_claim"
        urlState
        columns={['ref', 'title', { field: 'claim_kind', priority: 2 }, 'status', { field: 'incident_on', priority: 1 }, { field: 'policy_id', priority: 3 },
          { field: 'reserve', priority: 2 }, { field: 'paid', priority: 3 }, { field: 'recovered', priority: 3 }, { field: 'owner_id', priority: 3 }, { field: 'closed_on', hidden: true }]}
        filters={['status', 'claim_kind', 'direction', 'policy_id', 'owner_id', 'incident_on', 'closed_on', 'restricted']}
        createFields={CLAIM_CREATE}
      />
    </div>
  );
}

export function ClaimDetail() {
  return <RecordPage type="insurance_claim" summaryFields={CLAIM_CREATE} />;
}

// ---------- the renewal calendar ----------

interface CalendarItem { kind: 'policy_expires' | 'application_due' | 'certificate_expires'; date: string; record_type: string; id: string; ref: string | null; title: string; line: string | null; route: string; check_result?: string | null }
const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  policy_expires: 'Policy expires', application_due: 'Renewal application due', certificate_expires: 'Certificate of insurance expires',
};

export function RenewalCalendar() {
  const [months, setMonths] = useState('12');
  const { data, error, reload } = useFetch<{ today: string; from: string; to: string; items: CalendarItem[] }>(`/api/insurance/renewals?months=${months}`);
  const byMonth = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const i of data?.items ?? []) {
      const k = i.date.slice(0, 7);
      (m.get(k) ?? m.set(k, []).get(k)!).push(i);
    }
    return [...m.entries()];
  }, [data]);
  const monthName = (ym: string) => new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="stack">
      <PageHeader title="Renewal calendar" subtitle="Policy expiry dates, renewal applications due and vendor certificates of insurance expiring, month by month." />
      <div className="ins-toolbar">
        <Select label="Show" value={months} onChange={setMonths} options={[{ value: '3', label: 'Next three months' }, { value: '6', label: 'Next six months' }, { value: '12', label: 'Next twelve months' }, { value: '24', label: 'Next two years' }]} />
      </div>
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : !data ? <Card><Loading lines={5} label="Loading the calendar" /></Card>
        : byMonth.length === 0 ? <Card><EmptyState icon="calendar" title="Nothing due in this period" message="Policies and certificates with dates in the period are listed here." /></Card>
        : byMonth.map(([ym, items]) => (
          <Card key={ym} title={monthName(ym)} flush>
            <TableWrap label={`Insurance dates in ${monthName(ym)}`} fit>
              <table className="table">
                <caption className="sr-only">{`Insurance dates in ${monthName(ym)}`}</caption>
                <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Record</th><th scope="col" data-priority="2">Line</th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={`${i.kind}-${i.id}`}>
                      <td>{formatDate(i.date)}{i.date < data.today && <span className="ins-bad ins-small ins-block">Past</span>}</td>
                      <td>{KIND_LABEL[i.kind]}</td>
                      <td><Link className="row-title" to={i.route}>{i.ref && <span className="ref">{i.ref}</span>} {i.title}</Link></td>
                      <td data-priority="2">{i.line ? <LookupChip list="insurance_line" value={i.line} /> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        ))}
    </div>
  );
}

// ---------- settings ----------

interface SettingRow { key: string; label: string; max: number; default: number[]; value: number[] }
type SettingsAnswer = Record<'renewal' | 'application' | 'certificate', SettingRow>;
const SETTING_HINT: Record<keyof SettingsAnswer, string> = {
  renewal: 'Days before a policy expires, for example 90, 60, 30. Reminders stop once the renewal is bound or the policy is not being renewed.',
  application: 'Days before the renewal application is due, for example 14, 3, 0 (on the day).',
  certificate: 'Days before a vendor\'s certificate of insurance expires, for example 30, 0.',
};
const LISTS: [string, string][] = [
  ['insurance_line', 'Lines of coverage'], ['insurer_kind', 'Placed with'], ['insurance_policy_status', 'Policy statuses'], ['insurance_renewal_status', 'Renewal steps'],
  ['insurance_condition_status', 'Condition assessments'], ['insurance_certificate_status', 'Certificate statuses'], ['insurance_claim_status', 'Claim statuses'],
  ['insurance_claim_kind', 'Claim kinds'], ['insurance_claim_direction', 'Claim directions'],
];

export function InsuranceSettings() {
  const { data, error, reload } = useFetch<SettingsAnswer>('/api/insurance/settings');
  const { can } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Record<keyof SettingsAnswer, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Object.keys(draft).length > 0;
  const unsaved = useUnsavedChanges(dirty);
  const text = (k: keyof SettingsAnswer) => draft[k] ?? data?.[k].value.join(', ') ?? '';
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const body: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(draft)) body[k] = String(v).split(/[,\s]+/).filter(Boolean).map(Number);
      await api.put('/api/insurance/settings', body);
      unsaved.release(); setDraft({}); toast.success('Settings saved.'); reload();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHeader title="Insurance settings" subtitle="When owners are reminded, and the lists the insurance records use." />
      <div className="ins-grid">
        <Card title="Reminders">
          {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} /> : (
            <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
              {(Object.keys(SETTING_HINT) as (keyof SettingsAnswer)[]).map((k) => (
                <TextField key={k} label={data[k].label} value={text(k)} onChange={(v) => setDraft({ ...draft, [k]: v })} error={errors[k]} hint={SETTING_HINT[k]} inputMode="numeric" />
              ))}
              <div className="form-actions">
                <Button type="button" disabled={!dirty} onClick={() => { setDraft({}); setErrors({}); }}>Undo changes</Button>
                <Button type="submit" variant="primary" disabled={!dirty || !can('insurance.administer')} loading={busy}>Save</Button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Lists">
          <p className="muted">Each list can be changed under Administration &gt; Lists: add values, rename them or put them in another order.</p>
          <ul className="ins-links">
            {LISTS.map(([key, label]) => <li key={key}><Link to={`/admin/lists?list=${key}`}>{label}</Link></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
