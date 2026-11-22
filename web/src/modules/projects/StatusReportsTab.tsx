import { useEffect, useState } from 'react';
import { Group, SimpleGrid, Stack, Text, ThemeIcon, Timeline } from '@mantine/core';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, errorMessage, ErrorState, formatDate, Loading,
  Menu, Modal, Select, TextArea, useAuth, useFetch, useToast,
} from '../../core';
import { RagChip, TrendArrow } from './bits';
import { StatusTrend } from './StatusTrend';
import { RAG_COLOR, RAG_DIMENSIONS, RAG_LABEL, RAG_OPTIONS, todayIso, type RagTrend, type StatusReport, type TrendPoint } from './types';

interface Trend { series: TrendPoint[]; direction: RagTrend | null }

const BLANK = { period_end: '', overall: '', schedule: '', budget: '', risk: '', accomplishments: '', next_steps: '', decisions_needed: '' };
type Form = typeof BLANK;

function ReportDialog({ projectId, open, report, onClose, onSaved }: {
  projectId: string; open: boolean; report: StatusReport | null; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form>({ ...BLANK, period_end: todayIso() });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const startForm = (): Form => (report ? {
    period_end: String(report.period_end).slice(0, 10), overall: report.overall, schedule: report.schedule, budget: report.budget, risk: report.risk,
    accomplishments: report.accomplishments ?? '', next_steps: report.next_steps ?? '', decisions_needed: report.decisions_needed ?? '',
  } : { ...BLANK, period_end: todayIso() });
  const dirty = open && JSON.stringify(form) !== JSON.stringify(startForm());

  useEffect(() => {
    if (!open) return;
    setForm(startForm());
    setFields({});
    setFormError('');
  }, [open, report]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (report) await api.patch(`/api/projects/${projectId}/status-reports/${report.id}`, form);
      else await api.post(`/api/projects/${projectId}/status-reports`, form);
      toast.success(report ? 'Status report saved.' : 'Status report added.');
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
    <Modal open={open} title={report ? 'Edit status report' : 'Add status report'} onClose={onClose} size="lg" dirty={dirty}>
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
          <Button type="submit" variant="primary" loading={busy}>{report ? 'Save changes' : 'Add report'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <Text size="xs" fw={650} c="dimmed" tt="uppercase" className="prj-eyebrow">{title}</Text>
      <Text size="sm" className="prose">{text}</Text>
    </div>
  );
}

/** Status reports: the trend of the four ratings, then each report on a timeline, newest first. */
export function StatusReportsTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const reports = useFetch<StatusReport[]>(`/api/projects/${projectId}/status-reports`);
  const trend = useFetch<Trend>(`/api/projects/${projectId}/status-trend`);
  const [dialog, setDialog] = useState<{ open: boolean; report: StatusReport | null }>({ open: false, report: null });
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
  const addButton = canEdit
    ? <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, report: null })}>Add status report</Button>
    : undefined;

  return (
    <div className="stack">
      {reports.data.length === 0 ? (
        <Card>
          <EmptyState icon="chart" title="No status reports yet" message="Add a report each period. The latest ratings show on the project and in the portfolio." action={addButton} />
        </Card>
      ) : (
        <>
          <Card
            title="Trend"
            actions={trend.data?.direction ? <Group gap={6}><Text size="sm" c="dimmed">Overall</Text><TrendArrow trend={trend.data.direction} /></Group> : undefined}
          >
            {trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : !trend.data ? <Loading lines={2} /> : <StatusTrend points={trend.data.series} />}
          </Card>
          <Card title="Reports" actions={addButton}>
            <Timeline bulletSize={28} lineWidth={2} active={-1} className="prj-reports">
              {reports.data.map((r) => (
                <Timeline.Item
                  key={r.id}
                  bullet={(
                    <ThemeIcon size={28} radius="xl" variant="light" color={RAG_COLOR[r.overall] ?? 'gray'} aria-hidden="true">
                      <Text size="xs" fw={700}>{(RAG_LABEL[r.overall] ?? '?').charAt(0)}</Text>
                    </ThemeIcon>
                  )}
                  title={(
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={650} component="h3" size="sm">Period ending {formatDate(r.period_end)}</Text>
                      {canEdit && (
                        <Menu
                          label={`Actions for the report ending ${formatDate(r.period_end)}`}
                          icon="more" iconOnly variant="ghost" size="sm" align="end"
                          items={[
                            { label: 'Edit', icon: 'edit', onSelect: () => setDialog({ open: true, report: r }) },
                            { label: 'Delete', icon: 'trash', danger: true, separated: true, onSelect: () => setRemoving(r) },
                          ]}
                        />
                      )}
                    </Group>
                  )}
                >
                  <Stack gap="xs">
                    <Text size="xs" c="dimmed">{r.author_name ?? 'Unknown author'} · added {formatDate(r.created_at)}</Text>
                    <Group gap={6}>
                      {RAG_DIMENSIONS.map((d) => <RagChip key={d.key} value={r[d.key]} label={d.label} />)}
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: r.decisions_needed ? 3 : 2 }} spacing="md">
                      <Section title="Accomplishments" text={r.accomplishments} />
                      <Section title="Next steps" text={r.next_steps} />
                      <Section title="Decisions needed" text={r.decisions_needed} />
                    </SimpleGrid>
                  </Stack>
                </Timeline.Item>
              ))}
            </Timeline>
          </Card>
        </>
      )}
      <ReportDialog projectId={projectId} open={dialog.open} report={dialog.report} onClose={() => setDialog((d) => ({ ...d, open: false }))} onSaved={refresh} />
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
