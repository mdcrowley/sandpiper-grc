import { useState } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, errorMessage, ErrorState, formatDate, Loading,
  Modal, Select, TextArea, useAuth, useFetch, useToast,
} from '../../core';
import { RagChip, TrendArrow } from './bits';
import { StatusTrend } from './StatusTrend';
import { RAG_DIMENSIONS, RAG_OPTIONS, todayIso, type RagTrend, type StatusReport, type TrendPoint } from './types';

interface Trend { series: TrendPoint[]; direction: RagTrend | null }

const BLANK = { period_end: '', overall: '', schedule: '', budget: '', risk: '', accomplishments: '', next_steps: '', decisions_needed: '' };

function ReportDialog({ projectId, open, onClose, onSaved }: { projectId: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...BLANK, period_end: todayIso() });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof BLANK) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing: Record<string, string> = {};
    if (!form.period_end) missing.period_end = 'Period end is required.';
    for (const d of RAG_DIMENSIONS) if (!form[d.key]) missing[d.key] = `${d.label} rating is required.`;
    setFields(missing);
    setFormError('');
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/status-reports`, form);
      toast.success('Status report added.');
      setForm({ ...BLANK, period_end: todayIso() });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Add status report" onClose={onClose} size="lg">
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <DateField label="Period end" required value={form.period_end} onChange={set('period_end')} error={fields.period_end} />
          <span />
          {RAG_DIMENSIONS.map((d) => (
            <Select key={d.key} label={`${d.label} rating`} required placeholder="Choose a rating" value={form[d.key]} onChange={set(d.key)} options={RAG_OPTIONS} error={fields[d.key]} />
          ))}
          <TextArea className="form-cell-wide" label="Accomplishments" value={form.accomplishments} onChange={set('accomplishments')} rows={3} />
          <TextArea className="form-cell-wide" label="Next steps" value={form.next_steps} onChange={set('next_steps')} rows={3} />
          <TextArea className="form-cell-wide" label="Decisions needed" value={form.decisions_needed} onChange={set('decisions_needed')} rows={2} />
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Add report</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Status reports: the trend of the four ratings, then each report, newest first. */
export function StatusReportsTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const reports = useFetch<StatusReport[]>(`/api/projects/${projectId}/status-reports`);
  const trend = useFetch<Trend>(`/api/projects/${projectId}/status-trend`);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StatusReport | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('projects.edit');
  const refresh = () => { reports.reload(); trend.reload(); onChanged(); };

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/projects/${projectId}/status-reports/${removing.id}`);
      toast.success('Status report deleted.');
      setRemoving(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (reports.error) return <ErrorState title="Status reports could not be loaded" error={reports.error} onRetry={reports.reload} />;
  if (!reports.data) return <Loading />;
  const addButton = canEdit ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add status report</Button> : undefined;

  return (
    <div className="stack">
      {reports.data.length === 0 ? (
        <EmptyState icon="chart" title="No status reports yet" message="Add a report each period. The latest ratings show on the project and in the portfolio." action={addButton} />
      ) : (
        <>
          <Card
            title="Trend"
            actions={<span className="row">{trend.data?.direction && <TrendArrow trend={trend.data.direction} />}{addButton}</span>}
          >
            {trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : !trend.data ? <Loading lines={2} /> : <StatusTrend points={trend.data.series} />}
          </Card>
          {reports.data.map((r) => (
            <article key={r.id} className="prj-report">
              <div className="prj-report-head">
                <h3>Period ending {formatDate(r.period_end)}</h3>
                <span className="muted">{r.author_name ?? 'Unknown author'}, {formatDate(r.created_at)}</span>
              </div>
              <div className="row">
                {RAG_DIMENSIONS.map((d) => <RagChip key={d.key} value={r[d.key]} label={d.label} />)}
              </div>
              {r.accomplishments && <><h4>Accomplishments</h4><p className="prose">{r.accomplishments}</p></>}
              {r.next_steps && <><h4>Next steps</h4><p className="prose">{r.next_steps}</p></>}
              {r.decisions_needed && <><h4>Decisions needed</h4><p className="prose">{r.decisions_needed}</p></>}
              {canEdit && (
                <div className="row" style={{ marginTop: 'var(--s-2)' }}>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(r)}>Delete</Button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      <ReportDialog projectId={projectId} open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this status report?"
        message={removing ? `The report for the period ending ${formatDate(removing.period_end)} will be removed and the project's latest ratings recalculated. The deletion is recorded in the history.` : ''}
        confirmLabel="Delete report"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
