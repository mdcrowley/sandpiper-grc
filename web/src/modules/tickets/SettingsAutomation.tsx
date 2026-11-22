// Escalation rules, the warning threshold and who belongs to each assignment group.
import { useEffect, useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import {
  api, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading, lookupLabel, LookupSelect, Modal, NumberField,
  Select, Switch, TextField, useFetch, UserPicker, useToast,
} from '../../core';
import { fieldErrors, put, splitMinutes, workingText, type DeskSettings, type EscalationRule } from './util';

interface RulesResult { rules: EscalationRule[]; conditions: { value: string; label: string }[] }
interface RuleDraft { id?: string; name: string; condition: string; h: number | null; m: number | null; to: 'user' | 'group'; to_user_id: string | null; to_user_name?: string; to_group: string; enabled: boolean }

export function EscalationSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<RulesResult>('/api/tickets/escalation-rules');
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [opened, setOpened] = useState<RuleDraft | null>(null);   // the draft the dialog opened with
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<EscalationRule | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the escalation rules" />;
  const conditionLabel = (value: string) => data.conditions.find((c) => c.value === value)?.label ?? value;
  const blank: RuleDraft = { name: '', condition: 'unassigned', h: 1, m: 0, to: 'group', to_user_id: null, to_group: '', enabled: true };
  const begin = (d: RuleDraft) => { setDraft(d); setOpened(d); };
  const edit = (r: EscalationRule) => {
    const t = splitMinutes(r.wait_minutes);
    setErrors({});
    begin({ id: r.id, name: r.name, condition: r.condition, h: t.h, m: t.m, to: r.to_user_id ? 'user' : 'group', to_user_id: r.to_user_id, to_user_name: r.to_user_name ?? undefined, to_group: r.to_group ?? '', enabled: r.enabled });
  };

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErrors({});
    const body = {
      name: draft.name, condition: draft.condition, wait_minutes: (draft.h ?? 0) * 60 + (draft.m ?? 0), enabled: draft.enabled,
      to_user_id: draft.to === 'user' ? draft.to_user_id : null, to_group: draft.to === 'group' ? draft.to_group || null : null,
    };
    try {
      if (draft.id) await put(`/api/tickets/escalation-rules/${draft.id}`, body);
      else await api.post('/api/tickets/escalation-rules', body);
      toast.success(draft.id ? 'Escalation rule saved.' : 'Escalation rule added.');
      setDraft(null);
      reload();
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: EscalationRule, enabled: boolean) {
    try {
      await put(`/api/tickets/escalation-rules/${r.id}`, { enabled });
      toast.success(enabled ? `“${r.name}” switched on.` : `“${r.name}” switched off.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/tickets/escalation-rules/${removing.id}`);
      toast.success('Escalation rule removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Escalation rules" flush={data.rules.length > 0}
      actions={canEdit ? <Button size="sm" icon="plus" onClick={() => { setErrors({}); begin(blank); }}>New rule</Button> : undefined}>
      {data.rules.length === 0 ? (
        <EmptyState icon="arrow-up" title="No escalation rules"
          message="A rule tells a named person or group when an open ticket has waited too long. The wait is counted in the ticket’s working calendar, and each rule fires once for each ticket."
          action={canEdit ? <Button variant="primary" icon="plus" onClick={() => { setErrors({}); begin(blank); }}>New rule</Button> : undefined} />
      ) : (
        <div className="table-wrap">
          <table className="table sd-table">
            <thead>
              <tr><th scope="col">Rule</th><th scope="col">When an open ticket</th><th scope="col">Escalate to</th><th scope="col" className="num">Fired</th><th scope="col">On</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td>{conditionLabel(r.condition)} for {workingText(r.wait_minutes)} of working time</td>
                  <td>{r.to_user_id ? r.to_user_name ?? 'Unknown user' : <>{lookupLabel('assignment_group', r.to_group)} <Badge color="gray">Group</Badge></>}</td>
                  <td className="num">{r.fired}</td>
                  <td>{canEdit
                    ? <Switch label={`Rule ${r.name} is on`} checked={r.enabled} onChange={(v) => toggle(r, v)} className="sd-switch-only" />
                    : r.enabled ? <Badge color="green">On</Badge> : <Badge color="gray">Off</Badge>}</td>
                  {canEdit && (
                    <td className="sd-row-actions">
                      <IconButton icon="edit" variant="ghost" size="sm" label={`Edit rule ${r.name}`} onClick={() => edit(r)} />
                      <IconButton icon="trash" variant="ghost" size="sm" label={`Remove rule ${r.name}`} onClick={() => setRemoving(r)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={draft !== null} title={draft?.id ? 'Edit escalation rule' : 'New escalation rule'} onClose={() => setDraft(null)}
        dirty={draft !== null && JSON.stringify(draft) !== JSON.stringify(opened)}
        footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{draft?.id ? 'Save rule' : 'Add rule'}</Button></>}>
        {draft && (
          <div className="stack">
            <TextField label="Name" required autoFocus value={draft.name} error={errors.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="For example Unassigned for two hours" />
            <Select label="When an open ticket" required value={draft.condition} error={errors.condition} options={data.conditions.map((c) => ({ value: c.value, label: c.label }))}
              onChange={(v) => setDraft({ ...draft, condition: v })}
              hint={draft.condition === 'untouched' ? 'Counted from the last change to the ticket.' : 'Counted from when the ticket was opened.'} />
            <div className="field">
              <span className="field-label">For this much working time</span>
              <div className="sd-duration" role="group" aria-label="For this much working time">
                <NumberField label="Hours" hideLabel min={0} max={999} value={draft.h} onChange={(v) => setDraft({ ...draft, h: v })} />
                <span aria-hidden="true">h</span>
                <NumberField label="Minutes" hideLabel min={0} max={59} value={draft.m} onChange={(v) => setDraft({ ...draft, m: v })} />
                <span aria-hidden="true">m</span>
              </div>
              {errors.wait_minutes ? <span className="field-error" role="alert">{errors.wait_minutes}</span>
                : <span className="field-hint">Counted on the calendar of the ticket’s priority. Paused tickets are left alone.</span>}
            </div>
            <div className="field">
              <span className="field-label" id="sd-esc-to">Escalate to</span>
              <SegmentedControl aria-labelledby="sd-esc-to" size="sm" value={draft.to} onChange={(v) => setDraft({ ...draft, to: v as 'user' | 'group' })}
                data={[{ value: 'group', label: 'An assignment group' }, { value: 'user', label: 'A person' }]} />
            </div>
            {draft.to === 'user'
              ? <UserPicker label="Person" required value={draft.to_user_id} display={draft.to_user_name} error={errors.to_user_id}
                  onChange={(id, o) => setDraft({ ...draft, to_user_id: id, to_user_name: o?.label })} />
              : <LookupSelect label="Assignment group" required list="assignment_group" value={draft.to_group} error={errors.to_group ?? errors.to_user_id}
                  onChange={(v) => setDraft({ ...draft, to_group: v })} hint="Members are set under Notifications. A group with no members means everyone who works tickets." />}
            <Switch label="Rule is on" checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>
        )}
      </Modal>
      <ConfirmDialog open={removing !== null} danger busy={busy} title="Remove this rule?" confirmLabel="Remove rule"
        message={`“${removing?.name ?? ''}” will stop escalating tickets. Escalations it already made stay in each ticket’s history.`}
        onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

export function NotificationSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<DeskSettings>('/api/tickets/sla/settings');
  const [pct, setPct] = useState<number | null>(null);
  const [groups, setGroups] = useState<DeskSettings['groups']>([]);
  const [pctError, setPctError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setPct(data.warning_pct); setGroups(data.groups); setPctError(''); } }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading the notification settings" />;
  const ids = (g: DeskSettings['groups']) => JSON.stringify(g.map((x) => [x.value, x.members.map((m) => m.id)]));
  const dirty = pct !== data.warning_pct || ids(groups) !== ids(data.groups);
  const change = (value: string, members: { id: string; label: string }[]) => setGroups((old) => old.map((g) => (g.value === value ? { ...g, members } : g)));

  async function save() {
    setBusy(true);
    setPctError('');
    try {
      await put('/api/tickets/sla/settings', { warning_pct: pct ?? 0, group_members: Object.fromEntries(groups.map((g) => [g.value, g.members.map((m) => m.id)])) });
      toast.success('Notification settings saved.');
      reload();
    } catch (err) {
      setPctError(fieldErrors(err).warning_pct ?? '');
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {!data.notifications && <p className="notice notice-pilot">The notification service is not running on this server, so nothing is sent. The settings are kept for when it is.</p>}
      <Card title="Who is told, and when">
        <ul className="sd-plain-list">
          <li><strong>Assigned.</strong> The new assignee is told when a ticket is given to them by someone else.</li>
          <li><strong>Close to a target.</strong> The assignee is warned once for each clock when the share below has been used.</li>
          <li><strong>Target missed.</strong> The assignee is told at the moment a respond or resolve target passes.</li>
          <li><strong>Nobody assigned.</strong> The members of the ticket’s assignment group are told instead; with no group or no members, everyone who works tickets.</li>
        </ul>
        <div className="sd-inline-form">
          <NumberField label="Warn when this share of the time is used (%)" min={0} max={99} value={pct} disabled={!canEdit} error={pctError || undefined} onChange={setPct}
            hint="For example 75. Enter 0 to switch warnings off." />
        </div>
      </Card>
      <Card title="Assignment group members">
        <p className="muted">Used for notifications and escalation only. Any agent can still assign a ticket to any group.</p>
        <div className="sd-groups">
          {groups.map((g) => (
            <div key={g.value} className="sd-group">
              <h3>{g.label}</h3>
              {g.members.length === 0 ? <p className="muted">No members: everyone who works tickets is told.</p> : (
                <ul className="sd-members">
                  {g.members.map((m) => (
                    <li key={m.id}>
                      <span>{m.label}</span>
                      {canEdit && <IconButton icon="x" variant="ghost" size="sm" label={`Remove ${m.label} from ${g.label}`} onClick={() => change(g.value, g.members.filter((x) => x.id !== m.id))} />}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <UserPicker label={`Add a member to ${g.label}`} hideLabel placeholder="Add a member…" value={null}
                  onChange={(id, o) => { if (id && !g.members.some((m) => m.id === id)) change(g.value, [...g.members, { id, label: o?.label ?? 'User' }]); }} />
              )}
            </div>
          ))}
        </div>
      </Card>
      {canEdit && (
        <div className="form-actions">
          <Button disabled={!dirty || busy} onClick={() => { setPct(data.warning_pct); setGroups(data.groups); }}>Undo changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save notification settings</Button>
        </div>
      )}
    </div>
  );
}
