// Ticket page: header with one-click actions, the cockpit strip (status, clocks, assignee, next
// step), then the work on the left (description, request details, tasks, activity) and the
// facts on the right (details, requester, vendor, dates).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, Checkbox, DefinitionList, EditableSummary, errorMessage, formatDate, formatDateTime, LookupChip, ProgressBar, RecordPage,
  ResourceForm, TextArea, useFetch, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { Cockpit } from './Cockpit';
import { MajorIncident } from './MajorIncident';
import { ScorePicker, TicketActions } from './TicketActions';
import { minutesText, type Answer, type Suggestions, type Task } from './util';

function Description({ rec }: { rec: RecordContext }) {
  const { row, reload, canEdit } = rec;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  return (
    <Card title="Description" actions={canEdit && !editing ? <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      {editing ? (
        <ResourceForm type="ticket" id={row.id} initial={row} fields={['title', 'description']} onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); toast.success('Changes saved.'); reload(); }} />
      ) : row.description ? <div className="prose sd-description">{row.description}</div>
        : <p className="muted">No description was given.{canEdit ? ' Select Edit to add one.' : ''}</p>}
    </Card>
  );
}

function RequestDetails({ row }: { row: Row }) {
  const answers = (row.catalog_answers ?? []) as Answer[];
  if (!answers.length) return null;
  return (
    <Card title="Request details" actions={row._display?.catalog_item_id ? <Link to={`/catalogue/${row.catalog_item_id}`}>{row._display.catalog_item_id}</Link> : undefined}>
      <DefinitionList items={answers.map((a) => ({ label: a.label, value: <span className="prose">{/^\d{4}-\d{2}-\d{2}$/.test(a.value) ? formatDate(a.value) : a.value}</span>, wide: a.value.length > 70 || a.value.includes('\n') }))} />
    </Card>
  );
}

function FulfilmentTasks({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tasks = (row.fulfilment_tasks ?? []) as Task[];
  if (!tasks.length) return null;
  const done = tasks.filter((t) => t.done).length;
  async function toggle(index: number, checked: boolean) {
    setBusy(true);
    try {
      await save({ fulfilment_tasks: tasks.map((t, i) => ({ title: t.title, done: i === index ? checked : t.done })) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Fulfilment tasks" actions={<span className="muted">{done} of {tasks.length} done</span>}>
      <ProgressBar hideLabel label="Fulfilment tasks done" value={done} max={tasks.length} color={done === tasks.length ? 'green' : 'blue'} valueText={`${done} of ${tasks.length}`} />
      <ul className="sd-tasks">
        {tasks.map((t, i) => (
          <li key={`${i}:${t.title}`} className={t.done ? 'is-done' : undefined}>
            <Checkbox label={t.title} checked={t.done} disabled={!canEdit || busy} onChange={(c) => toggle(i, c)}
              hint={t.done && t.done_at ? `Done ${formatDateTime(t.done_at)}${t.done_by_name ? ` by ${t.done_by_name}` : ''}` : undefined} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Open tickets about the same thing, and published articles that may answer it. */
function MayHelp({ row }: { row: Row }) {
  const { data } = useFetch<Suggestions>(row.resolved_at ? null : `/api/tickets/suggest?title=${encodeURIComponent(row.title ?? '')}&exclude=${row.id}`);
  if (!data || (!data.tickets.length && !data.articles.length)) return null;
  return (
    <Card title="May help">
      <div className="sd-suggest sd-suggest-plain">
        {data.articles.length > 0 && (
          <div>
            <h3>Knowledge articles</h3>
            <ul>{data.articles.map((a) => <li key={a.id}><Link to={`/knowledge/${a.id}`}><span className="ref">{a.ref}</span> {a.title}</Link></li>)}</ul>
          </div>
        )}
        {data.tickets.length > 0 && (
          <div>
            <h3>Similar tickets</h3>
            <ul>
              {data.tickets.map((s) => (
                <li key={s.id}><Link to={`/tickets/${s.id}`}><span className="ref">{s.ref}</span> {s.title}</Link> <LookupChip list="ticket_status" value={s.status} /></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function VendorPanel({ row }: { row: Row }) {
  if (!row.with_vendor && !row.vendor_ref && !row.vendor_raised_at) return null;
  const raised = row.vendor_raised_at ? new Date(row.vendor_raised_at).getTime() : null;
  const responded = row.vendor_responded_at ? new Date(row.vendor_responded_at).getTime() : null;
  return (
    <Card title="Vendor" actions={row.with_vendor ? <Badge color="orange">With vendor</Badge> : <Badge color="gray">Back from vendor</Badge>}>
      <DefinitionList items={[
        { label: 'Vendor', value: row._display?.vendor_id ?? '—' },
        { label: 'Vendor reference', value: row.vendor_ref ?? '—' },
        { label: 'Raised', value: formatDateTime(row.vendor_raised_at) },
        { label: 'Vendor responded', value: row.vendor_responded_at ? formatDateTime(row.vendor_responded_at) : 'Not yet' },
        { label: 'Vendor response time', value: raised && responded ? minutesText((responded - raised) / 60000)
          : raised && row.with_vendor ? `Waiting ${minutesText((Date.now() - raised) / 60000)} so far` : '—' },
      ]} />
      <p className="muted">Change these under More actions. Vendors have no access to this system; staff record what they do.</p>
    </Card>
  );
}

/** Shown on a closed ticket: the recorded score, or a place to record one. */
function SatisfactionCard({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (row.satisfaction_score) {
    return (
      <Card title="Requester satisfaction">
        <p><strong>{row.satisfaction_score} out of 5</strong>{row.satisfaction_comment ? <span className="prose"> — {row.satisfaction_comment}</span> : null}</p>
        {row.satisfaction_by_requester && (
          <p className="muted">Given by the requester in the self-service portal{row.satisfaction_at ? ` on ${formatDateTime(row.satisfaction_at)}` : ''}. It cannot be changed.</p>
        )}
      </Card>
    );
  }
  if (!row.closed_at || row.status === 'cancelled') return null;
  if (!canEdit) return null;
  async function submit() {
    setBusy(true);
    try {
      await save({ satisfaction_score: score, satisfaction_comment: comment.trim() || null });
      toast.success('Satisfaction recorded.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Requester satisfaction">
      <ScorePicker value={score} onChange={setScore} />
      <TextArea label="Comment" rows={2} value={comment} onChange={setComment} />
      <div className="form-actions"><Button variant="primary" disabled={score === null} loading={busy} onClick={submit}>Save</Button></div>
    </Card>
  );
}

function Summary({ rec }: { rec: RecordContext }) {
  const { row, reload } = rec;
  const has = (f: string) => f in rec.resource.fields;
  return (
    <>
      <div className="sd-main">
        <Description rec={rec} />
        <RequestDetails row={row} />
        <FulfilmentTasks rec={rec} />
        {(row.resolved_at || row.resolution_code || row.resolution_notes) && (
          <EditableSummary type="ticket" row={row} onSaved={reload} title="Resolution" fields={['resolution_code', 'resolution_notes']} />
        )}
        <SatisfactionCard rec={rec} />
      </div>
      <aside className="sd-side" aria-label="Ticket facts">
        <EditableSummary
          type="ticket" row={row} onSaved={reload}
          fields={['type', 'category', 'subcategory', 'impact', 'urgency', 'priority', 'assignment_group', 'assignee_id',
            'system_id', 'asset_id', 'problem_id', 'catalog_item_id', 'channel'].filter(has)}
        />
        <EditableSummary type="ticket" row={row} onSaved={reload} title="Requester"
          fields={['requester_name', 'requester_department', 'requester_email', 'requester_id', 'affected_user', 'affected_user_id'].filter(has)} />
        {row.channel === 'portal' && (
          <p className="muted sd-portal-note">Raised in the self-service portal. The requester sees public comments only{row.reopened_count ? `, and has reopened it ${row.reopened_count === 1 ? 'once' : `${row.reopened_count} times`}` : ''}.</p>
        )}
        <VendorPanel row={row} />
        <MayHelp row={row} />
        <Card title="Dates">
          <DefinitionList items={[
            { label: 'Opened', value: formatDateTime(row.opened_at) },
            { label: 'First response', value: row.first_responded_at ? formatDateTime(row.first_responded_at) : 'Not yet' },
            { label: 'Resolved', value: row.resolved_at ? formatDateTime(row.resolved_at) : 'Not yet' },
            ...(row.closed_at ? [{ label: row.status === 'cancelled' ? 'Cancelled' : 'Closed', value: formatDateTime(row.closed_at) }] : []),
          ]} />
        </Card>
      </aside>
    </>
  );
}

/** Tells the page whether the loaded ticket is flagged, so the Major incident tab appears only then. */
function FlagSync({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  useEffect(() => { onChange(value); }, [value, onChange]);
  return null;
}

export function TicketDetail() {
  const [major, setMajor] = useState(false);
  return (
    <div className="sd-ticket">
      <RecordPage
        type="ticket"
        subtitle={(row) => (
          <>
            {row._display?.type ?? 'Ticket'} for {row.requester_name || 'an unnamed requester'}
            {row.requester_department ? ` (${row.requester_department})` : ''} · opened {formatDateTime(row.opened_at)}
          </>
        )}
        status={(row) => (
          <span className="row">
            <LookupChip list="ticket_priority" value={row.priority} />
            {row.major_incident && <Badge color="red">Major incident</Badge>}
            {row.with_vendor && <Badge color="orange">With vendor</Badge>}
            {row.escalated_at && !row.resolved_at && <Badge color="purple">Escalated</Badge>}
          </span>
        )}
        actions={(rec) => <TicketActions rec={rec} />}
        banner={(rec) => <><FlagSync value={!!rec.row.major_incident} onChange={setMajor} /><Cockpit rec={rec} /></>}
        summary={(rec) => <Summary rec={rec} />}
        tabs={major ? [{ key: 'major', label: 'Major incident', content: (rec) => <MajorIncident rec={rec} /> }] : []}
      />
    </div>
  );
}
