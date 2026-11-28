// Committees: the list, and one committee with its members by side, its quorum, its meetings and
// the approvals waiting for its chair.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, Checkbox, ConfirmDialog, DateField, EditableSummary, EmptyState, errorMessage, ErrorState, formatDate,
  formatDateTime, Loading, LookupChip, LookupSelect, Modal, PageHeader, RecordPage, RecordPicker, ResourceList, TableWrap, TextField, useAuth,
  useFetch, useLookup, useResource, useToast, UserPicker,
} from '../../core';
import type { Row } from '../../core';
import { GovernanceTabs, type Member } from './shared';
import { WorkPlanCard } from './Interests';

const CREATE = ['name', 'kind', 'purpose', 'chair_id', 'secretary_id', 'quorum_rule', 'quorum_value', 'resolution_prefix', 'meeting_frequency', 'joint_labor_management'];

export function CommitteeList() {
  return (
    <div className="stack">
      <PageHeader title="Committees" subtitle="Your governing body and committees: who sits on them, for which side, and their quorum." />
      <GovernanceTabs active="committees" />
      <ResourceList
        type="committee"
        urlState
        columns={['ref', 'name', 'kind', 'status', 'chair_id', 'secretary_id', 'meeting_frequency', 'joint_labor_management']}
        filters={['kind', 'status', 'chair_id', 'joint_labor_management']}
        createFields={CREATE}
      />
    </div>
  );
}

interface Quorum { voting: number; needed: number; rule: string; value: number | null }

function MemberDialog({ committeeId, member, onClose, onSaved }: { committeeId: string; member: Member | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const roster = useResource('person');
  const [form, setForm] = useState({
    user_id: member?.user_id ?? null as string | null, person_id: member?.person_id ?? null as string | null, name: member?.name ?? '',
    side: member?.side ?? '', role: member?.role ?? 'member', voting: member?.voting ?? true, from_on: member?.from_on ?? '', to_on: member?.to_on ?? '',
  });
  const [start] = useState(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setBusy(true); setErrors({});
    const body = { ...form, side: form.side || null, from_on: form.from_on || null, to_on: form.to_on || null, ...(roster ? {} : { person_id: undefined }) };
    try {
      if (member) await api.patch(`/api/committees/${committeeId}/members/${member.id}`, body);
      else await api.post(`/api/committees/${committeeId}/members`, body);
      toast.success(member ? 'Member updated.' : 'Member added.');
      onSaved();
    } catch (err) {
      setErrors((err as { fields?: Record<string, string> }).fields ?? {});
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={member ? 'Change member' : 'Add a member'} onClose={onClose} dirty={JSON.stringify(form) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{member ? 'Save' : 'Add'}</Button></>}>
      <div className="form-grid">
        <UserPicker label="Account" value={form.user_id} display={member?.user_name ?? undefined} error={errors.user_id}
          hint="Members with an account can be named as approvers and receive reminders." onChange={(id) => set({ user_id: id })} />
        {roster && <RecordPicker label="Roster person" type="person" value={form.person_id} error={errors.person_id} onChange={(id) => set({ person_id: id })} />}
        <TextField label="Name" value={form.name} error={errors.name} hint="Taken from the account or roster person when left empty." onChange={(v) => set({ name: v })} />
        <LookupSelect label="Side" list="committee_side" value={form.side} error={errors.side} onChange={(v) => set({ side: v })} />
        <LookupSelect label="Role" list="committee_role" required value={form.role} error={errors.role} onChange={(v) => set({ role: v || 'member' })} />
        <Checkbox label="Votes" checked={form.voting} hint="Only voting members count toward the quorum." onChange={(v) => set({ voting: v })} />
        <DateField label="Member from" value={form.from_on} error={errors.from_on} onChange={(v) => set({ from_on: v })} />
        <DateField label="Member until" value={form.to_on} error={errors.to_on} onChange={(v) => set({ to_on: v })} />
      </div>
    </Modal>
  );
}

function Members({ committee }: { committee: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const sides = useLookup('committee_side');
  const { data, error, reload } = useFetch<Member[]>(`/api/committees/${committee.id}/members`);
  const quorum = useFetch<Quorum>(`/api/committees/${committee.id}/quorum`);
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('governance.edit');
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/committees/${committee.id}/members/${removing.id}`); toast.success('Member removed.'); setRemoving(null); reload(); quorum.reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const groups = data ? [...sides.map((s) => ({ key: s.value, label: s.label })), { key: '', label: 'No side given' }]
    .map((g) => ({ ...g, rows: data.filter((m) => (m.side ?? '') === g.key) })).filter((g) => g.rows.length) : [];
  const current = data?.filter((m) => m.current) ?? [];
  const lopsided = committee.joint_labor_management && data
    && !(current.some((m) => m.side === 'management') && current.some((m) => m.side === 'labor'));
  return (
    <div className="stack">
      {quorum.data && (
        <p className="notice">
          Quorum: {quorum.data.needed} of {quorum.data.voting} voting member{quorum.data.voting === 1 ? '' : 's'} in office today
          {quorum.data.value ? ` (${quorum.data.rule === 'percent' ? `${quorum.data.value}% of voting members` : `${quorum.data.value} members`})` : ' (a majority, as no quorum is set)'}.
        </p>
      )}
      {lopsided && <p className="notice notice-warn">This is a joint labor-management committee, but it does not have members in office from both management and labor.</p>}
      <Card title="Members" flush actions={canEdit && <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a member</Button>}>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="gv-pad"><Loading lines={3} /></div>
          : data.length === 0 ? <EmptyState icon="users" title="No members yet" message="Add the members, the side each sits for, and whether they vote." />
          : groups.map((g) => (
            <TableWrap label={`${g.label} (${g.rows.length})`} className="gv-group" key={g.key}>
              <table className="table">
                <caption className="gv-caption">{g.label} ({g.rows.length})</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Votes</th><th scope="col">Term</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {g.rows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}{m.user_id && <span className="muted"> (account)</span>}{!m.current && <> <Badge color="gray">Not in office</Badge></>}</td>
                      <td><LookupChip list="committee_role" value={m.role} /></td>
                      <td>{m.voting ? 'Yes' : 'No'}</td>
                      <td>{m.from_on || m.to_on ? `${m.from_on ? formatDate(m.from_on) : 'Start'} to ${m.to_on ? formatDate(m.to_on) : 'now'}` : <span className="muted">Open</span>}</td>
                      <td className="gv-actions">
                        {canEdit && <Button size="sm" variant="ghost" aria-label={`Change: ${m.name}`} onClick={() => setEditing(m)}>Change</Button>}
                        {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove: ${m.name}`} onClick={() => setRemoving(m)}>Remove</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ))}
      </Card>
      {editing && <MemberDialog committeeId={committee.id} member={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); quorum.reload(); }} />}
      <ConfirmDialog open={!!removing} title="Remove this member?" danger busy={busy} confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
        message={`${removing?.name ?? 'The member'} will be removed. Past attendance keeps their name. To end a term instead, set the "Member until" date.`} />
    </div>
  );
}

function Meetings({ committeeId }: { committeeId: string }) {
  return (
    <ResourceList type="meeting" baseFilter={{ committee_id: committeeId }} createInitial={{ committee_id: committeeId }}
      columns={['ref', 'title', 'scheduled_at', 'status', 'quorum_met']} filters={['status', 'scheduled_at']}
      createFields={['title', 'scheduled_at', 'location']} bulkFields={[]} />
  );
}

export interface Waiting { kind: string; kind_label: string; instance_id: string; workflow: string; started_at: string; record_type: string; type_label: string; record_id: string; label: string; ref: string | null; route: string }

export function WaitingApprovals({ committeeId, onPick, picking }: { committeeId: string; onPick?: (w: Waiting) => void; picking?: boolean }) {
  const { data, error, reload } = useFetch<{ chair_id: string | null; items: Waiting[] }>(`/api/governance/waiting-decisions?committee=${committeeId}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.chair_id) return <EmptyState icon="user" title="No chair named" message="Name the committee's chair to see the approvals waiting for them." />;
  if (!data.items.length) return <EmptyState icon="check-circle" title="Nothing waiting for the chair" message="No approval step is waiting for the chair's decision now." />;
  return (
    <TableWrap label="Approvals waiting for the chair">
      <table className="table">
        <caption className="sr-only">Approvals waiting for the chair</caption>
        <thead><tr><th scope="col">Record</th><th scope="col">Approval</th><th scope="col">Waiting since</th>{onPick && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>
          {data.items.map((w) => (
            <tr key={w.instance_id}>
              <td><Link to={`${w.route}/${w.record_id}`}><span className="muted">{w.type_label}</span> {w.ref ? <span className="ref">{w.ref}</span> : null} {w.label}</Link></td>
              <td>{w.kind_label}<div className="muted">{w.workflow}</div></td>
              <td>{formatDateTime(w.started_at)}</td>
              {onPick && <td className="gv-actions"><Button size="sm" loading={picking} onClick={() => onPick(w)}>Put on the agenda</Button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function CommitteeDetail() {
  return (
    <RecordPage
      type="committee"
      summary={({ row, reload }) => (
        <div className="gv-summary">
          <EditableSummary type="committee" row={row} onSaved={reload} title="Committee"
            fields={['name', 'kind', 'status', 'purpose', 'meeting_frequency', 'joint_labor_management']} />
          <EditableSummary type="committee" row={row} onSaved={reload} title="Chair, secretary and quorum"
            fields={['chair_id', 'secretary_id', 'quorum_rule', 'quorum_value', 'resolution_prefix']} />
        </div>
      )}
      tabs={[
        { key: 'members', label: 'Members', content: ({ row }) => <Members committee={row} /> },
        { key: 'meetings', label: 'Meetings', content: ({ row }) => <Meetings committeeId={row.id} /> },
        { key: 'work-plan', label: 'Work plan', content: ({ row }) => <WorkPlanCard committee={row} /> },
        { key: 'waiting', label: 'Waiting for the chair', content: ({ row }) => <Card title="Approvals waiting for the chair"><WaitingApprovals committeeId={row.id} /></Card> },
      ]}
    />
  );
}
