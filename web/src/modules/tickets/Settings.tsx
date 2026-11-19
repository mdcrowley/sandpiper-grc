// Service desk settings: priority matrix, service-level targets, working calendars and
// holidays, escalation rules and notifications. People without tickets.administer read only.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button, Card, ErrorState, errorMessage, Loading, LookupChip, LookupSelect, lookupColor, NumberField, PageHeader, Select, Tabs,
  useAuth, useFetch, useLookup, useToast,
} from '../../core';
import { EscalationSettings, NotificationSettings } from './SettingsAutomation';
import { CalendarSettings } from './SettingsCalendars';
import { PortalSettingsTab } from './SettingsPortal';
import { fieldErrors, put, splitMinutes, workingText, type Calendar, type Policy, type PriorityMatrix } from './util';

export const APPLY_NOTE = 'Changes apply to due times worked out from now on: new tickets, and tickets whose priority changes. Tickets already logged keep the due times they have.';

function ReadOnlyNote() {
  return <p className="notice">You can see these settings but not change them. Changing them needs the permission to administer the service desk.</p>;
}

/* ---------- Priority matrix ---------- */

function MatrixSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const impacts = useLookup('ticket_impact');
  const urgencies = useLookup('ticket_urgency');
  const { data, error, reload } = useFetch<PriorityMatrix>('/api/tickets/priority-matrix');
  const [m, setM] = useState<PriorityMatrix | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setM(data); }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !m) return <Loading lines={5} label="Loading the priority matrix" />;
  const dirty = JSON.stringify(m) !== JSON.stringify(data);
  const cell = (impact: string, urgency: string) => m.cells?.[impact]?.[urgency] ?? '';
  const setCell = (impact: string, urgency: string, value: string) => setM((old) => {
    const cells = { ...old!.cells, [impact]: { ...(old!.cells[impact] ?? {}) } };
    if (value) cells[impact][urgency] = value; else delete cells[impact][urgency];
    return { ...old!, cells };
  });

  async function save() {
    setBusy(true);
    try {
      await put('/api/tickets/priority-matrix', m);
      toast.success('Priority matrix saved.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Priority from impact and urgency">
      <p className="muted">When a ticket is logged, its priority is read from this table. An agent can still set a priority by hand.</p>
      <div className="table-wrap">
        <table className="table sd-table sd-matrix">
          <thead>
            <tr>
              <th scope="col"><span className="muted">Impact ↓ &nbsp; Urgency →</span></th>
              {urgencies.map((u) => <th key={u.value} scope="col">{u.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {impacts.map((i) => (
              <tr key={i.value}>
                <th scope="row">{i.label}</th>
                {urgencies.map((u) => {
                  const value = cell(i.value, u.value);
                  return (
                    <td key={u.value} className="sd-matrix-cell" style={{ background: value ? `var(--c-${lookupColor('ticket_priority', value)}-bg)` : undefined }}>
                      {canEdit ? (
                        <LookupSelect label={`Priority for impact ${i.label}, urgency ${u.label}`} hideLabel list="ticket_priority" placeholder="Default"
                          value={value} onChange={(v) => setCell(i.value, u.value, v)} />
                      ) : value ? <LookupChip list="ticket_priority" value={value} /> : <span className="muted">Default</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sd-inline-form">
        {canEdit
          ? <LookupSelect label="Default priority" list="ticket_priority" required value={m.default} onChange={(v) => setM({ ...m, default: v })}
              hint="Used for any combination left empty above, and for impact or urgency values added later." />
          : <p>Default priority: <LookupChip list="ticket_priority" value={m.default} /></p>}
      </div>
      {canEdit && (
        <div className="form-actions">
          <Button disabled={!dirty || busy} onClick={() => setM(data)}>Undo changes</Button>
          <Button variant="primary" disabled={!dirty || !m.default} loading={busy} onClick={save}>Save matrix</Button>
        </div>
      )}
    </Card>
  );
}

/* ---------- Targets ---------- */

interface Draft { rh: number | null; rm: number | null; sh: number | null; sm: number | null; calendar_id: string }

function Duration({ label, h, m, onChange, disabled, error }: {
  label: string; h: number | null; m: number | null; disabled?: boolean; error?: string; onChange: (h: number | null, m: number | null) => void;
}) {
  return (
    <div className="sd-duration" role="group" aria-label={label}>
      <NumberField label={`${label}: hours`} hideLabel size="xs" min={0} max={999} value={h} disabled={disabled} onChange={(v) => onChange(v, m)} />
      <span aria-hidden="true">h</span>
      <NumberField label={`${label}: minutes`} hideLabel size="xs" min={0} max={59} value={m} disabled={disabled} onChange={(v) => onChange(h, v)} />
      <span aria-hidden="true">m</span>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

function TargetSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const priorities = useLookup('ticket_priority');
  const policies = useFetch<Policy[]>('/api/tickets/sla/policies');
  const calendars = useFetch<Calendar[]>('/api/tickets/sla/calendars');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const saved = useMemo(() => {
    const out: Record<string, Draft> = {};
    for (const p of policies.data ?? []) {
      const r = splitMinutes(p.respond_minutes);
      const s = splitMinutes(p.resolve_minutes);
      out[p.priority] = { rh: r.h, rm: r.m, sh: s.h, sm: s.m, calendar_id: p.calendar_id };
    }
    return out;
  }, [policies.data]);
  useEffect(() => { setDrafts(saved); setErrors({}); }, [saved]);

  if (policies.error) return <ErrorState error={policies.error} onRetry={policies.reload} />;
  if (calendars.error) return <ErrorState error={calendars.error} onRetry={calendars.reload} />;
  if (!policies.data || !calendars.data) return <Loading lines={5} label="Loading the targets" />;

  const empty: Draft = { rh: null, rm: null, sh: null, sm: null, calendar_id: '' };
  const draft = (p: string) => drafts[p] ?? empty;
  const set = (p: string, patch: Partial<Draft>) => setDrafts((old) => ({ ...old, [p]: { ...(old[p] ?? empty), ...patch } }));
  const changed = priorities.filter((p) => JSON.stringify(draft(p.value)) !== JSON.stringify(saved[p.value] ?? empty));
  const mins = (h: number | null, m: number | null) => (h ?? 0) * 60 + (m ?? 0);

  async function save() {
    setBusy(true);
    const failed: Record<string, Record<string, string>> = {};
    let done = 0;
    for (const p of changed) {
      const d = draft(p.value);
      try {
        await put(`/api/tickets/sla/policies/${p.value}`, { respond_minutes: mins(d.rh, d.rm), resolve_minutes: mins(d.sh, d.sm), calendar_id: d.calendar_id });
        done += 1;
      } catch (err) {
        failed[p.value] = { ...fieldErrors(err), _: errorMessage(err) };
      }
    }
    setBusy(false);
    setErrors(failed);
    if (done) toast.success(done === 1 ? 'Targets saved for one priority.' : `Targets saved for ${done} priorities.`);
    if (Object.keys(failed).length) toast.error('Some targets could not be saved. Check the highlighted rows.');
    else policies.reload();
  }

  return (
    <Card title="Respond and resolve targets">
      <p className="notice">{APPLY_NOTE}</p>
      <div className="table-wrap">
        <table className="table sd-table sd-targets">
          <thead>
            <tr><th scope="col">Priority</th><th scope="col">Respond within</th><th scope="col">Resolve within</th><th scope="col">Hours counted on</th></tr>
          </thead>
          <tbody>
            {priorities.map((p) => {
              const d = draft(p.value);
              const e = errors[p.value] ?? {};
              return (
                <tr key={p.value}>
                  <th scope="row"><LookupChip list="ticket_priority" value={p.value} />{!saved[p.value] && <div className="muted">No target yet</div>}</th>
                  {canEdit ? (
                    <>
                      <td><Duration label={`${p.label} respond within`} h={d.rh} m={d.rm} error={e.respond_minutes} onChange={(h, m) => set(p.value, { rh: h, rm: m })} /></td>
                      <td><Duration label={`${p.label} resolve within`} h={d.sh} m={d.sm} error={e.resolve_minutes} onChange={(h, m) => set(p.value, { sh: h, sm: m })} /></td>
                      <td>
                        <Select label={`${p.label} calendar`} hideLabel size="xs" required value={d.calendar_id} error={e.calendar_id}
                          options={calendars.data!.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set(p.value, { calendar_id: v })} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{saved[p.value] ? workingText(mins(d.rh, d.rm)) : '—'}</td>
                      <td>{saved[p.value] ? workingText(mins(d.sh, d.sm)) : '—'}</td>
                      <td>{calendars.data!.find((c) => c.id === d.calendar_id)?.name ?? '—'}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">Times are working time on the chosen calendar. With business hours of 08:00 to 17:00, 27 hours is three working days.</p>
      {canEdit && (
        <div className="form-actions">
          <Button disabled={!changed.length || busy} onClick={() => { setDrafts(saved); setErrors({}); }}>Undo changes</Button>
          <Button variant="primary" disabled={!changed.length} loading={busy} onClick={save}>Save targets</Button>
        </div>
      )}
    </Card>
  );
}

/* ---------- Page ---------- */

export function ServiceDeskSettings() {
  const { can } = useAuth();
  const canEdit = can('tickets.administer');
  const [params, setParams] = useSearchParams();
  const tabs = [
    { key: 'priorities', label: 'Priorities', content: <MatrixSettings canEdit={canEdit} /> },
    { key: 'targets', label: 'Targets', content: <TargetSettings canEdit={canEdit} /> },
    { key: 'calendars', label: 'Calendars and holidays', content: <CalendarSettings canEdit={canEdit} /> },
    { key: 'escalation', label: 'Escalation', content: <EscalationSettings canEdit={canEdit} /> },
    { key: 'notifications', label: 'Notifications', content: <NotificationSettings canEdit={canEdit} /> },
    { key: 'portal', label: 'Self-service portal', content: <PortalSettingsTab /> },
  ];
  const active = tabs.some((t) => t.key === params.get('tab')) ? (params.get('tab') as string) : 'priorities';
  return (
    <div className="sd-settings">
      <PageHeader
        title="Service desk settings"
        subtitle="How priority is worked out, how long each priority has, when the clock runs, and who is told."
        breadcrumbs={[{ label: 'Tickets', to: '/tickets' }, { label: 'Settings' }]}
      />
      {!canEdit && <ReadOnlyNote />}
      <Tabs label="Service desk settings" tabs={tabs} active={active}
        onChange={(key) => setParams((p) => { p.set('tab', key); return p; }, { replace: true })} />
    </div>
  );
}
