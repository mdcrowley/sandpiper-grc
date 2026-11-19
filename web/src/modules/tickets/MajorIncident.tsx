// Major incident coordination: child tickets, a timeline with a communications log, and the post-incident review.
import { useMemo, useState } from 'react';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, RecordPicker, ResourceList,
  TextArea, Timeline as UiTimeline, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { RecordActions, useHasActions } from './actions';
import { NewTicketDialog } from './NewTicketDialog';

interface Comment { id: string; body: string; internal: boolean; author_name: string | null; created_at: string }

function ChildTickets({ rec }: { rec: RecordContext }) {
  const { row, canEdit } = rec;
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function link() {
    if (!pick) return;
    setBusy(true);
    try {
      await api.patch(`/api/tickets/${pick}`, { parent_ticket_id: row.id });
      setPick(null);
      setVersion((n) => n + 1);
      toast.success('Ticket linked as a child.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Child tickets" flush>
      {canEdit && (
        <div className="sd-child-tools">
          <RecordPicker label="Link an existing ticket" type="ticket" value={pick} onChange={(id) => setPick(id)} placeholder="Search by reference or title" />
          <Button onClick={link} loading={busy} disabled={!pick || pick === row.id}>Link</Button>
          <Button icon="plus" onClick={() => setAdding(true)}>New child ticket</Button>
        </div>
      )}
      <ResourceList
        key={version}
        type="ticket"
        baseFilter={{ parent_ticket_id: row.id }}
        urlState={false}
        columns={['ref', 'title', 'status', 'priority', 'requester_name', 'requester_department', 'assignee_id', 'opened_at']}
        pageSize={10}
      />
      <NewTicketDialog
        open={adding}
        title="New child ticket"
        initial={{ parent_ticket_id: row.id, type: 'incident', category: row.category ?? '', impact: 'individual', urgency: row.urgency ?? 'medium' }}
        onClose={() => setAdding(false)}
        onCreated={(_row, another) => { if (!another) setAdding(false); setVersion((n) => n + 1); }}
      />
    </Card>
  );
}

function Timeline({ rec }: { rec: RecordContext }) {
  const { row, canEdit } = rec;
  const toast = useToast();
  const { data, error, reload } = useFetch<Comment[]>(`/api/comments?record_type=ticket&record_id=${row.id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const events = useMemo(() => {
    const marks: { at: string; what: string; who?: string; kind: string }[] = [
      { at: row.opened_at, what: 'Incident logged', kind: 'mark' },
      row.first_responded_at && { at: row.first_responded_at, what: 'First response', kind: 'mark' },
      row.vendor_raised_at && { at: row.vendor_raised_at, what: `Raised with vendor${row.vendor_ref ? ` (${row.vendor_ref})` : ''}`, kind: 'mark' },
      row.vendor_responded_at && { at: row.vendor_responded_at, what: 'Vendor responded', kind: 'mark' },
      row.resolved_at && { at: row.resolved_at, what: 'Resolved', kind: 'mark' },
      row.closed_at && { at: row.closed_at, what: 'Closed', kind: 'mark' },
    ].filter(Boolean) as { at: string; what: string; kind: string }[];
    for (const c of data ?? []) {
      marks.push({ at: c.created_at, what: c.body, who: c.author_name ?? 'Unknown', kind: c.internal ? 'note' : 'comms' });
    }
    return marks.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [data, row]);

  async function add(internal: boolean) {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/comments', { record_type: 'ticket', record_id: row.id, body: text.trim(), internal });
      setText('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Timeline and communications log">
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} /> : (
        <UiTimeline
          label="Major incident timeline"
          items={events.map((e, i) => ({
            key: String(i),
            title: e.kind === 'comms' ? 'Communication sent' : e.kind === 'note' ? 'Note' : e.what,
            timeText: formatDateTime(e.at),
            meta: e.who,
            icon: e.kind === 'comms' ? 'message' : e.kind === 'note' ? 'edit' : 'clock',
            color: e.kind === 'comms' ? 'teal' : e.kind === 'note' ? 'gray' : 'blue',
            body: e.kind === 'mark' ? undefined : <span className="prose">{e.what}</span>,
          }))}
        />
      )}
      {canEdit && (
        <div className="stack sd-log-add">
          <TextArea label="Add to the log" rows={2} value={text} onChange={setText}
            hint="Record a decision or finding as a note, or what was told to staff and when as a communication." />
          <div className="row">
            <Button onClick={() => add(true)} loading={busy} disabled={!text.trim()}>Add note</Button>
            <Button onClick={() => add(false)} loading={busy} disabled={!text.trim()}>Add communication</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const PIR_FIELDS: [string, string, string][] = [
  ['summary', 'What happened', 'A few plain sentences: what stopped working, for whom and for how long.'],
  ['root_cause', 'Root cause', 'What caused it, as far as is known.'],
  ['went_well', 'What went well', ''],
  ['to_improve', 'What to improve', ''],
  ['actions', 'Follow-up actions', 'A summary. Track each one under Actions below, where it gets an owner and a due date.'],
];

function Review({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const saved = (row.post_incident_review ?? {}) as Record<string, string>;
  const [v, setV] = useState<Record<string, string>>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  async function submit() {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(v).filter(([, val]) => String(val ?? '').trim() !== ''));
      await save({ post_incident_review: Object.keys(clean).length ? clean : null });
      toast.success('Post-incident review saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit && !Object.keys(saved).length) {
    return <Card title="Post-incident review"><EmptyState title="No review yet" message="The review is written once the incident is resolved." icon="clipboard" /></Card>;
  }
  return (
    <Card title="Post-incident review">
      {!row.resolved_at && <p className="muted">The incident is still open. Notes can be started now and finished after it is resolved.</p>}
      <div className="stack">
        {PIR_FIELDS.map(([key, label, hint]) => (
          <TextArea key={key} label={label} hint={hint || undefined} rows={3} disabled={!canEdit}
            value={v[key] ?? ''} onChange={(val) => setV((old) => ({ ...old, [key]: val }))} />
        ))}
        <DateField label="Review completed on" disabled={!canEdit} value={v.completed_on ?? ''} onChange={(val) => setV((old) => ({ ...old, completed_on: val }))} />
        {canEdit && <div className="form-actions"><Button variant="primary" loading={busy} disabled={!dirty} onClick={submit}>Save review</Button></div>}
      </div>
    </Card>
  );
}

export function MajorIncident({ rec }: { rec: RecordContext }) {
  const hasActions = useHasActions();
  return (
    <div className="stack">
      <ChildTickets rec={rec} />
      <Timeline rec={rec} />
      <Review rec={rec} />
      {hasActions && <RecordActions sourceType="ticket" sourceId={rec.row.id} />}
    </div>
  );
}
