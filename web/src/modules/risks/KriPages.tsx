import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, Loading, Modal, NumberField, PageHeader, RecordPage,
  ResourceList, Select, Stat, StatusChip, TableWrap, TextArea, TextField, todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { ColorName, ListResult, RecordContext, Row } from '../../core';
import { RiskTabs } from './RiskTabs';

// Key risk indicators (E30-07): the list and one indicator with its monthly values. An indicator is
// entered by hand each month or computed every day from a metric another module offers; at red it
// brings its risk's review forward and tells the owners. Indicators are restricted like risks.

const LEVEL: Record<string, { label: string; color: ColorName }> = {
  green: { label: 'Green', color: 'green' }, amber: { label: 'Amber', color: 'amber' }, red: { label: 'Red', color: 'red' },
};

/** The traffic light of a value, or a dash when there is none. */
export function KriLevel({ level }: { level: string | null | undefined }) {
  const l = level ? LEVEL[level] : undefined;
  return l ? <StatusChip color={l.color} label={l.label} /> : <span className="muted">—</span>;
}

const fmt = (v: unknown, unit?: string | null) => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit === 'percent' ? '%' : ''}`);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Indicators of one risk, for the risk's page. */
export function RiskKris({ riskId }: { riskId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<ListResult>(`/api/kris?f.risk_id=${encodeURIComponent(riskId)}&sort=ref&pageSize=50`);
  return (
    <Card
      title="Key risk indicators"
      actions={can('risks.create') && <Link className="btn btn-ghost btn-sm" to="/kris?new=1">Add indicator</Link>}
      flush
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rk-panel-pad"><Loading lines={2} label="Loading indicators" /></div>
        : data.rows.length === 0 ? <EmptyState icon="target" title="No indicators for this risk" message="Indicators with amber and red thresholds warn early when the risk is growing." />
        : (
          <TableWrap label="Key risk indicators of this risk">
            <table className="table">
              <caption className="sr-only">Key risk indicators of this risk</caption>
              <thead><tr><th scope="col">Indicator</th><th scope="col">Latest</th><th scope="col">Level</th><th scope="col">Thresholds</th></tr></thead>
              <tbody>
                {data.rows.map((k) => (
                  <tr key={k.id}>
                    <td><Link to={`/kris/${k.id}`}><span className="ref">{k.ref}</span> {k.name}</Link></td>
                    <td>{k.last_period ? <span className="rk-two-line"><span>{fmt(k.last_value, k.unit)}</span><span className="muted">{monthLabel(String(k.last_period).slice(0, 7))}</span></span> : <span className="muted">No value yet</span>}</td>
                    <td><KriLevel level={k.last_level} /></td>
                    <td className="muted">Amber {fmt(k.amber, k.unit)}, red {fmt(k.red, k.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
    </Card>
  );
}

export function KriList() {
  const red = useFetch<ListResult>('/api/kris?f.last_level=red&f.status=active&pageSize=1');
  const amber = useFetch<ListResult>('/api/kris?f.last_level=amber&f.status=active&pageSize=1');
  const all = useFetch<ListResult>('/api/kris?f.status=active&pageSize=1');
  return (
    <div className="stack">
      <PageHeader
        title="Key risk indicators"
        subtitle="Early warnings for the risk register: a monthly value against amber and red thresholds, entered by hand or computed from the application's own records. Restricted, like risks."
      />
      <RiskTabs active="indicators" />
      <div className="grid-stats">
        <Stat label="Active indicators" value={all.data?.total ?? '–'} color="blue" icon="target" />
        <Stat label="At red" value={red.data?.total ?? '–'} color={(red.data?.total ?? 0) > 0 ? 'red' : 'green'} to="/kris?f.last_level=red&f.status=active" />
        <Stat label="At amber" value={amber.data?.total ?? '–'} color={(amber.data?.total ?? 0) > 0 ? 'amber' : 'green'} to="/kris?f.last_level=amber&f.status=active" />
      </div>
      <ResourceList
        type="kri"
        urlState
        columns={[
          'ref', 'name', 'risk_id',
          { field: 'last_value', label: 'Latest value', sortable: true, render: (row) => (row.last_period ? <span className="rk-two-line"><span>{fmt(row.last_value, row.unit)}</span><span className="muted">{monthLabel(String(row.last_period).slice(0, 7))}</span></span> : <span className="muted">No value yet</span>) },
          { field: 'last_level', label: 'Level', sortable: true, render: (row) => <KriLevel level={row.last_level} /> },
          { field: 'metric_key', label: 'Source', render: (row) => (row.metric_key ? 'Computed' : 'Entered by hand') },
          'owner_id', 'status', { field: 'amber', hidden: true }, { field: 'red', hidden: true }, { field: 'direction', hidden: true },
        ]}
        filters={['status', 'risk_id', 'owner_id', 'direction']}
        bulkFields={['owner_id', 'status']}
        defaultSort={{ field: 'ref', dir: 'asc' }}
        createFields={['name', 'description', 'risk_id', 'unit', 'direction', 'amber', 'red', 'frequency', 'owner_id']}
      />
    </div>
  );
}

interface Values {
  values: { id: string; period: string; value: number | null; level: string | null; note: string | null; entered_by_name: string | null }[];
  computed: boolean;
  metric: { key: string; label: string; unit: string; description: string } | null;
}
interface Metric { key: string; label: string; unit: string; description: string }

/** Chooses whether the indicator is entered by hand or computed from a metric. */
function SourceCard({ rec, values }: { rec: RecordContext; values: Values | null }) {
  const toast = useToast();
  const metrics = useFetch<{ metrics: Metric[] }>('/api/metrics');
  const [key, setKey] = useState<string>(rec.row.metric_key ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setKey(rec.row.metric_key ?? ''), [rec.row.metric_key]);
  const options = [{ value: '', label: 'Entered by hand each month' }, ...(metrics.data?.metrics ?? []).map((m) => ({ value: m.key, label: m.label }))];
  const chosen = metrics.data?.metrics.find((m) => m.key === key);

  const save = async () => {
    setSaving(true);
    try {
      await rec.save({ metric_key: key || null, ...(chosen ? { unit: chosen.unit } : {}) });
      toast.success(key ? 'The indicator is now computed every day.' : 'The indicator is now entered by hand.');
      rec.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Where the value comes from">
      {metrics.error ? <ErrorState error={metrics.error} onRetry={metrics.reload} /> : (
        <div className="form">
          <Select label="Source" value={key} options={options} onChange={setKey} disabled={!rec.canEdit} hint={chosen?.description ?? values?.metric?.description ?? 'Someone enters the value for each month.'} />
          {rec.canEdit && key !== (rec.row.metric_key ?? '') && (
            <div className="form-actions"><Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>Save source</Button></div>
          )}
        </div>
      )}
    </Card>
  );
}

function ValueDialog({ kri, onClose, onDone }: { kri: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [period, setPeriod] = useState(todayInZone().slice(0, 7));
  const [firstPeriod] = useState(period);
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const saved = await api.put<Row>(`/api/kris/${kri.id}/values/${encodeURIComponent(period)}`, { value, note });
      toast.success(saved.last_level === 'red' ? 'Value saved. It is at red: the risk\'s review is now due.' : 'Value saved.');
      onDone();
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : {});
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title="Enter a value" size="sm" onClose={onClose} dirty={value !== null || Boolean(note.trim()) || period !== firstPeriod}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <p role="alert" className="form-error">{message}</p>}
        <TextField label="Month" required value={period} onChange={setPeriod} error={errors.period} hint="YYYY-MM. Entering a month again corrects it." inputMode="numeric" maxLength={7} />
        <NumberField label={`Value${kri.unit === 'percent' ? ' (%)' : ''}`} required value={value} onChange={setValue} min={kri.unit === 'count' || kri.unit === 'percent' ? 0 : undefined} max={kri.unit === 'percent' ? 100 : undefined} error={errors.value} />
        <TextArea label="Note" rows={2} value={note} onChange={setNote} error={errors.note} hint="Optional: what explains the value." />
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Save value</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function ValuesPanel({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const { data, error, reload } = useFetch<Values>(`/api/kris/${row.id}/values`);
  const [entering, setEntering] = useState(false);
  const done = () => { reload(); rec.reload(); };
  return (
    <div className="stack">
      <Card
        title="Monthly values"
        flush
        actions={rec.canEdit && data && !data.computed && <Button size="sm" icon="plus" onClick={() => setEntering(true)}>Enter a value</Button>}
      >
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="rk-panel-pad"><Loading lines={3} label="Loading values" /></div>
          : data.values.length === 0 ? (
            <EmptyState icon="target" title="No values yet" message={data.computed ? 'Computed values appear after the daily check runs.' : 'Enter the value for each month.'} />
          ) : (
            <TableWrap label="Values of this indicator by month">
              <table className="table">
                <caption className="sr-only">Values of this indicator by month</caption>
                <thead><tr><th scope="col">Month</th><th scope="col">Value</th><th scope="col">Level</th><th scope="col">Note</th><th scope="col">Entered by</th></tr></thead>
                <tbody>
                  {data.values.map((v) => (
                    <tr key={v.id}>
                      <td>{monthLabel(v.period)}</td>
                      <td>{fmt(v.value, row.unit)}</td>
                      <td><KriLevel level={v.level} /></td>
                      <td>{v.note ?? <span className="muted">—</span>}</td>
                      <td>{v.entered_by_name ?? <span className="muted">{data.computed ? 'Computed' : 'System'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      <SourceCard rec={rec} values={data ?? null} />
      {entering && <ValueDialog kri={row} onClose={() => setEntering(false)} onDone={done} />}
    </div>
  );
}

export function KriDetail() {
  return (
    <RecordPage
      type="kri"
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div><span className="rk-step-label">Level</span><KriLevel level={row.last_level} /></div>
          <div><span className="rk-step-label">Latest value</span><strong>{row.last_period ? `${fmt(row.last_value, row.unit)} (${monthLabel(String(row.last_period).slice(0, 7))})` : 'No value yet'}</strong></div>
          <div><span className="rk-step-label">Amber at</span><span>{fmt(row.amber, row.unit)}</span></div>
          <div><span className="rk-step-label">Red at</span><span>{fmt(row.red, row.unit)}</span></div>
          <div><span className="rk-step-label">Risk</span>{row.risk_id ? <Link to={`/risks/${row.risk_id}`}>{row._display?.risk_id ?? 'Open the risk'}</Link> : <span className="muted">None</span>}</div>
        </div>
      )}
      summaryFields={['name', 'description', 'risk_id', 'unit', 'direction', 'amber', 'red', 'frequency', 'owner_id', 'status']}
      tabs={[{ key: 'values', label: 'Values', content: (rec) => <ValuesPanel rec={rec} /> }]}
    />
  );
}
