// Ticket detail: header, lifecycle stepper, live SLA clocks, quick actions, summary, vendor panel and tabs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, DefinitionList, EditableSummary, errorMessage, formatDateTime, LookupChip, RecordPage, Stepper,
  TextArea, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { MajorIncident } from './MajorIncident';
import { SlaClocks } from './SlaClocks';
import { ScorePicker, TicketActions } from './TicketActions';
import { minutesText, useStatuses } from './util';

function Lifecycle({ row }: { row: Row }) {
  const { category, statuses } = useStatuses();
  const cat = category(row.status);
  const label = statuses.find((s) => s.value === row.status)?.label ?? row._display?.status ?? row.status;
  const current = cat === 'closed' ? 'closed' : cat === 'resolved' ? 'resolved'
    : cat === 'paused' ? 'working'
    : row.status === 'new' ? (row.assignee_id ? 'assigned' : 'logged')
    : row.status === 'assigned' ? 'assigned' : 'working';
  const when = (v: unknown) => (v ? formatDateTime(v as string) : undefined);
  return (
    <Stepper
      label="Ticket lifecycle"
      current={current}
      blocked={cat === 'paused'}
      steps={[
        { key: 'logged', label: 'Logged', hint: when(row.opened_at) },
        { key: 'assigned', label: 'Assigned', hint: row._display?.assignee_id ?? when(row.first_responded_at) },
        { key: 'working', label: cat === 'paused' ? label : 'In progress', hint: cat === 'paused' ? 'Clock paused' : current === 'working' && row.status !== 'in_progress' ? label : undefined },
        { key: 'resolved', label: 'Resolved', hint: when(row.resolved_at) },
        { key: 'closed', label: row.status === 'cancelled' ? 'Cancelled' : 'Closed', hint: when(row.closed_at) },
      ]}
    />
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
      <p className="muted">Use More → Update vendor details to change these. Vendors have no access to this system; staff record their activity.</p>
    </Card>
  );
}

/** Shown on a closed ticket that has no satisfaction answer yet. */
function SatisfactionCard({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (!row.closed_at || row.status === 'cancelled') return null;
  if (row.satisfaction_score) {
    return (
      <Card title="Requester satisfaction">
        <p><strong>{row.satisfaction_score} out of 5</strong>{row.satisfaction_comment ? <span className="prose"> — {row.satisfaction_comment}</span> : null}</p>
      </Card>
    );
  }
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
      <div className="stack">
        <ScorePicker value={score} onChange={setScore} />
        <TextArea label="Comment" rows={2} value={comment} onChange={setComment} />
        <div className="form-actions"><Button variant="primary" disabled={score === null} loading={busy} onClick={submit}>Save</Button></div>
      </div>
    </Card>
  );
}

function Summary({ rec }: { rec: RecordContext }) {
  const { row, reload } = rec;
  const has = (f: string) => f in rec.resource.fields;
  return (
    <div className="stack">
      <SlaClocks rec={rec} />
      {row.parent_ticket_id && (
        <p className="sd-parent">Part of major incident <Link to={`/tickets/${row.parent_ticket_id}?tab=major`}>{row._display?.parent_ticket_id ?? 'parent ticket'}</Link>.</p>
      )}
      <EditableSummary
        type="ticket" row={row} onSaved={reload}
        fields={['title', 'description', 'type', 'category', 'subcategory', 'impact', 'urgency', 'priority',
          'requester_name', 'requester_department', 'requester_email', 'affected_user',
          'assignment_group', 'assignee_id', 'system_id', 'asset_id', 'catalog_item_id', 'problem_id', 'channel'].filter(has)}
      />
      {(row.resolved_at || row.resolution_code || row.resolution_notes) && (
        <EditableSummary type="ticket" row={row} onSaved={reload} title="Resolution" fields={['resolution_code', 'resolution_notes']} />
      )}
      <VendorPanel row={row} />
      <SatisfactionCard rec={rec} />
    </div>
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
          <LookupChip list="ticket_status" value={row.status} />
          {row.major_incident && <Badge color="red">Major incident</Badge>}
          {row.with_vendor && <Badge color="orange">With vendor</Badge>}
        </span>
      )}
      actions={(rec) => <TicketActions rec={rec} />}
      banner={({ row }) => <><FlagSync value={!!row.major_incident} onChange={setMajor} /><Lifecycle row={row} /></>}
      summary={(rec) => <Summary rec={rec} />}
      tabs={major ? [{ key: 'major', label: 'Major incident', content: (rec) => <MajorIncident rec={rec} /> }] : []}
    />
  );
}
