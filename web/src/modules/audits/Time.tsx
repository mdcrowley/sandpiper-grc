// An audit's time budget and the hours worked against it (E45-63): the budget (the audit's Budget
// field), the hours worked, what is left, by person and by workpaper step, and each entry.
import { useState } from 'react';
import {
  api, Button, Card, DateField, EmptyState, errorMessage, ErrorState, formatDate, IconButton, Loading, NumberField, ProgressBar, Select, Stat,
  TableWrap, TextField, todayInZone, useFetch, useToast,
} from '../../core';

interface TimeView {
  budget_hours: number | null; worked_hours: number; remaining_hours: number | null; used_pct: number | null; over_budget: boolean;
  by_person: { name: string; hours: number }[]; by_step: { item_id: string; hours: number }[];
  entries: { id: string; person_name: string; worked_on: string; hours: number; item_id: string | null; activity: string | null }[];
  can_record: boolean;
}
interface Steps { items: { id: string; prompt: string; wp_ref?: string | null }[] }

const hrs = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;

export function AuditTime({ auditId, closed }: { auditId: string; closed: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<TimeView>(`/api/audits/${auditId}/time`);
  const steps = useFetch<Steps>(`/api/audits/${auditId}/checklist`);
  const [form, setForm] = useState({ hours: null as number | null, worked_on: todayInZone(), item_id: '', activity: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<TimeView | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const d = view ?? data;
  const stepName = (id: string | null) => {
    const s = steps.data?.items?.find((i) => i.id === id);
    return s ? `${s.wp_ref ? `WP ${s.wp_ref} ` : ''}${s.prompt}` : '';
  };
  const record = async () => {
    setBusy(true); setErrors({});
    try {
      setView(await api.post<TimeView>(`/api/audits/${auditId}/time`, { hours: form.hours, worked_on: form.worked_on, item_id: form.item_id || undefined, activity: form.activity || undefined }));
      setForm((f) => ({ ...f, hours: null, activity: '' }));
      toast.success('Hours recorded.');
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { setView(await api.del<TimeView>(`/api/audits/${auditId}/time/${id}`)); toast.success('Entry removed.'); } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <div className="stack">
      <Card title="Time budget">
        <div className="au-time-stats">
          <Stat label="Budget" value={d.budget_hours === null ? 'Not set' : hrs(d.budget_hours)} hint={d.budget_hours === null ? 'Set the audit\'s Budget (hours) in its details.' : undefined} />
          <Stat label="Worked" value={hrs(d.worked_hours)} />
          <Stat label={d.over_budget ? 'Over budget' : 'Left'} value={d.remaining_hours === null ? '—' : hrs(Math.abs(d.remaining_hours))} color={d.over_budget ? 'red' : undefined} />
        </div>
        {d.used_pct !== null && <ProgressBar label="Budget used" value={Math.min(100, d.used_pct)} valueText={`${d.used_pct}%`} color={d.over_budget ? 'red' : d.used_pct > 85 ? 'orange' : 'blue'} />}
      </Card>
      {d.can_record && !closed && (
        <Card title="Record hours">
          <div className="form-grid">
            <NumberField label="Hours" required value={form.hours} min={0.25} max={24} step={0.25} error={errors.hours} onChange={(v) => setForm((f) => ({ ...f, hours: v ?? null }))} />
            <DateField label="Day" value={form.worked_on} error={errors.worked_on} onChange={(v) => setForm((f) => ({ ...f, worked_on: v ?? todayInZone() }))} />
            <Select label="Workpaper step (optional)" value={form.item_id} error={errors.item_id}
              options={[{ value: '', label: 'The audit as a whole' }, ...(steps.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.wp_ref ? `WP ${i.wp_ref} ` : ''}${i.prompt}`.slice(0, 90) }))]}
              onChange={(v) => setForm((f) => ({ ...f, item_id: v }))} />
            <TextField label="What was done (optional)" value={form.activity} onChange={(v) => setForm((f) => ({ ...f, activity: v }))} />
          </div>
          <div><Button variant="primary" loading={busy} disabled={!form.hours} onClick={() => void record()}>Record</Button></div>
        </Card>
      )}
      <Card title="Hours worked" flush>
        {d.entries.length === 0 ? <EmptyState icon="clock" title="No hours recorded" message="The audit team records the hours worked on the audit here, against its budget." /> : (
          <>
            <p className="au-meta" style={{ padding: 'var(--s-3) var(--s-4) 0' }}>By person: {d.by_person.map((p) => `${p.name} ${hrs(p.hours)}`).join(' · ')}</p>
            <TableWrap label="Hours worked">
              <table className="table">
                <thead><tr><th scope="col">Day</th><th scope="col">Person</th><th scope="col" className="num">Hours</th><th scope="col">Step and activity</th>{d.can_record && !closed && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.worked_on)}</td>
                      <td>{e.person_name}</td>
                      <td className="num">{hrs(e.hours)}</td>
                      <td>{[stepName(e.item_id), e.activity].filter(Boolean).join(' · ') || <span className="muted">The audit as a whole</span>}</td>
                      {d.can_record && !closed && <td><IconButton icon="x" size="sm" variant="ghost" label={`Remove the entry of ${e.person_name} on ${formatDate(e.worked_on)}`} onClick={() => void remove(e.id)} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Card>
    </div>
  );
}
