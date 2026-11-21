// The asset record's lifecycle pieces: the stage band with date countdowns, the assignment
// timeline, and the disposal tab with its approval requests.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Group, Paper, Progress, SimpleGrid, Text, Timeline } from '@mantine/core';
import {
  api, Button, Card, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Icon, Loading,
  Stepper, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { ColorName, Row } from '../../core';
import { DecideDialog, WhereDialog } from './AssetDialogs';
import type { DisposalRequest } from './AssetDialogs';
import { Callout, daysPhrase, daysUntil, useFunder } from './shared';

/* ---------- stage band ---------- */

function DateTile({ label, date, from, endedWord, soonDays }: { label: string; date: string | null; from?: string | null; endedWord: string; soonDays: number }) {
  const days = daysUntil(date);
  if (days === null) {
    return (
      <Paper withBorder radius="md" className="inv-date-tile inv-date-tile-empty">
        <Text size="sm" c="dimmed">{label}</Text>
        <Text fw={600}>Not recorded</Text>
        <Text size="sm" c="dimmed">Add the date under Purchase and support to be reminded before it passes.</Text>
      </Paper>
    );
  }
  const color: ColorName = days < 0 ? 'red' : days <= soonDays ? 'amber' : 'green';
  // How much of the period from purchase to the end date has gone.
  const total = from ? (daysUntil(date)! - daysUntil(from)!) : 0;
  const used = total > 0 ? Math.min(100, Math.max(0, Math.round(((total - days) / total) * 100))) : days < 0 ? 100 : null;
  return (
    <Paper withBorder radius="md" className={`inv-date-tile inv-date-tile-${color}`}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" c="dimmed">{label}</Text>
        <Badge color={color} variant="light">{days < 0 ? endedWord : days <= soonDays ? 'Ending soon' : 'Covered'}</Badge>
      </Group>
      <Text fw={650} size="lg">{days < 0 ? `Ended ${daysPhrase(days)}` : `Ends ${daysPhrase(days)}`}</Text>
      <Text size="sm" c="dimmed">{formatDate(date)}</Text>
      {used !== null && <Progress value={used} color={color} size="sm" mt={6} aria-label={`${used}% of the ${label.toLowerCase()} period has passed`} />}
    </Paper>
  );
}

export function LifecycleBand({ row }: { row: Row }) {
  const funder = useFunder();
  const statuses = useLookup('asset_status');
  // "In repair" is a detour rather than a stage: it shows only while the asset is there.
  const steps = statuses.filter((s) => s.value !== 'in_repair' || row.status === 'in_repair').map((s) => ({ key: s.value, label: s.label }));
  const gone = row.status === 'disposed';
  const held = !gone && row.status !== 'retired';
  return (
    <div className="stack">
      {steps.length > 0 && <Stepper label="Lifecycle" current={row.status} steps={steps} />}
      {gone ? (
        <Callout color="gray" title={`Disposed${row.disposed_on ? ` on ${formatDate(row.disposed_on)}` : ''}`}>
          Approved by {row.disposal_approved_by ?? 'unknown'}{row.disposal_approved_on ? ` on ${formatDate(row.disposal_approved_on)}` : ''}
          {row.disposal_approval_ref ? `, approval reference ${row.disposal_approval_ref}` : ''}{row.disposal_method ? `. Method: ${row.disposal_method}` : ''}.
        </Callout>
      ) : (
        <>
          {row.disposal_request_status === 'pending' && (
            <Callout color="amber" title="Disposal awaiting approval" action={<Link to="?tab=disposal">See the request</Link>}>
              A disposal has been requested. An approver other than the requester decides it.
            </Callout>
          )}
          {row.disposal_request_status === 'approved' && (
            <Callout color="green" title="Disposal approved" action={<Link to="?tab=disposal">See the approval</Link>}>
              Approved by {row.disposal_approved_by}{row.disposal_approved_on ? ` on ${formatDate(row.disposal_approved_on)}` : ''}. Select Dispose to complete it.
            </Callout>
          )}
          {funder.on && row.funder_interest && (
            <Callout color="amber" title={`${funder.label}${row.funder_interest_pct != null ? `: ${row.funder_interest_pct}%` : ''}`}>
              An outside funder keeps an interest in this asset. It cannot be disposed of until the funder's approval reference is entered.
            </Callout>
          )}
          {held && (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <DateTile label="Warranty" date={row.warranty_end} from={row.purchase_date} endedWord="Out of warranty" soonDays={90} />
              <DateTile label="Support" date={row.support_end} from={row.purchase_date} endedWord="Past support" soonDays={180} />
            </SimpleGrid>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- owner and place ---------- */

export function WhereCard({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const holder = row._display?.user_id ?? row.assigned_to_name;
  const items: [string, string | null | undefined][] = [
    ['Assigned to', holder], ['Owner', row._display?.owner_id], ['Department', row.department],
    ['Site', row._display?.site_id], ['Location', row.location],
  ];
  return (
    <Card title="Who has it and where" actions={canEdit && row.status !== 'disposed' && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit<span className="sr-only"> owner and place</span></Button>}>
      <dl className="inv-facts">
        {items.map(([label, value]) => (
          <div key={label} className="inv-fact-row">
            <dt>{label}</dt>
            <dd>{value ? (label === 'Site' && row.site_id ? <Link to={`/sites/${row.site_id}`}>{value}</Link> : value)
              : <span className="muted">{label === 'Assigned to' ? 'Nobody' : '—'}</span>}</dd>
          </div>
        ))}
      </dl>
      {editing && <WhereDialog asset={row} onClose={(changed) => { setEditing(false); if (changed) onChanged(); }} />}
    </Card>
  );
}

/* ---------- assignment ---------- */

interface Assignment {
  id: string; assignee: string; department: string | null; location: string | null; site_name: string | null;
  due_back_on: string | null; notes: string | null; checked_out_at: string; checked_out_by_name: string | null;
  checked_in_at: string | null; checked_in_by_name: string | null; check_in_notes: string | null; open: boolean;
}

export function AssignmentTab({ row, version }: { row: Row; version: number }) {
  const { data, error, reload } = useFetch<Assignment[]>(`/api/assets/${row.id}/assignments?v=${version}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} />;
  const open = data.find((a) => a.open);
  const due = daysUntil(open?.due_back_on);
  return (
    <div className="stack">
      <Card title="Current assignment">
        {open ? (
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="lg" fw={650}>{open.assignee}</Text>
              <Text size="sm" c="dimmed">
                {[open.department, open.site_name, open.location].filter(Boolean).join(' · ') || 'No department or place recorded'}
              </Text>
              <Text size="sm" c="dimmed">Checked out {formatDateTime(open.checked_out_at)}{open.checked_out_by_name ? ` by ${open.checked_out_by_name}` : ''}</Text>
            </div>
            {due === null ? <Badge color="gray" variant="light">Permanent assignment</Badge>
              : <Badge color={due < 0 ? 'red' : due <= 3 ? 'amber' : 'green'} variant="light" size="lg">{due < 0 ? `Was due back ${daysPhrase(due)}` : `Due back ${daysPhrase(due)}`}</Badge>}
          </Group>
        ) : row.user_id || row.assigned_to_name ? (
          <Text>With <strong>{row._display?.user_id ?? row.assigned_to_name}</strong>, recorded on the asset without a check-out.</Text>
        ) : (
          <Text c="dimmed">{row.status === 'disposed' ? 'Disposed; no longer assigned.' : 'Not assigned to anyone. Select Check out to hand it to someone.'}</Text>
        )}
      </Card>
      <Card title="Assignment history">
        {data.length === 0 ? (
          <EmptyState icon="user" title="Never checked out" message="When this asset is checked out to someone, each assignment is kept here." />
        ) : (
          <Timeline bulletSize={26} lineWidth={2} active={data.length} className="inv-timeline">
            {data.map((a) => (
              <Timeline.Item
                key={a.id} color={a.open ? 'green' : 'gray'} bullet={<Icon name={a.open ? 'user' : 'check'} size={14} />}
                title={<span>{a.assignee} {a.open && <Badge color="green" variant="light" ml={6}>Out now</Badge>}</span>}
              >
                {[a.department, a.site_name, a.location].filter(Boolean).length > 0 && (
                  <Text size="sm" c="dimmed">{[a.department, a.site_name, a.location].filter(Boolean).join(' · ')}</Text>
                )}
                <Text size="sm">
                  Checked out {formatDateTime(a.checked_out_at)}{a.checked_out_by_name ? ` by ${a.checked_out_by_name}` : ''}
                  {a.due_back_on ? `, due back ${formatDate(a.due_back_on)}` : ''}{a.notes ? `. ${a.notes}` : ''}
                </Text>
                {!a.open && (
                  <Text size="sm">
                    Checked in {formatDateTime(a.checked_in_at)}{a.checked_in_by_name ? ` by ${a.checked_in_by_name}` : ''}{a.check_in_notes ? `. ${a.check_in_notes}` : ''}
                  </Text>
                )}
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Card>
    </div>
  );
}

/* ---------- disposal ---------- */

const REQUEST_STATE: Record<DisposalRequest['status'], { label: string; color: ColorName }> = {
  pending: { label: 'Awaiting approval', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  refused: { label: 'Refused', color: 'red' },
  withdrawn: { label: 'Withdrawn', color: 'gray' },
};

/** One disposal request with its decision, and the buttons the reader may use on it. */
export function RequestCard({ request, label, onChanged, showAsset }: { request: DisposalRequest; label: string; onChanged: () => void; showAsset?: boolean }) {
  const funder = useFunder();
  const { can } = useAuth();
  const toast = useToast();
  const [deciding, setDeciding] = useState<'approve' | 'refuse' | null>(null);
  const [busy, setBusy] = useState(false);
  const state = REQUEST_STATE[request.status];
  const pending = request.status === 'pending';
  const wf = request.workflow ?? null;

  async function withdraw() {
    setBusy(true);
    try {
      await api.post(`/api/assets/${request.asset_id}/disposal-requests/${request.id}/withdraw`);
      toast.success('Request withdrawn.');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper withBorder radius="md" className="inv-request">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          {showAsset && <Text fw={650}><Link to={`/assets/${request.asset_id}?tab=disposal`}>{label}</Link></Text>}
          <Text size="sm"><strong>{request.requested_by_name ?? 'Someone'}</strong> asked on {formatDateTime(request.requested_at)}</Text>
        </div>
        <Group gap={6} wrap="nowrap">
          {funder.on && request.funder_interest && <Badge color="amber" variant="light">{funder.label}</Badge>}
          <Badge color={state.color} variant="light">{state.label}</Badge>
        </Group>
      </Group>
      <Text className="prose">{request.reason}</Text>
      {(request.disposal_method || request.approval_ref) && (
        <Text size="sm" c="dimmed">
          {[request.disposal_method && `Method: ${request.disposal_method}`, request.approval_ref && `Approval reference: ${request.approval_ref}`].filter(Boolean).join(' · ')}
        </Text>
      )}
      {request.decided_at && request.status !== 'withdrawn' && (
        <Text size="sm">
          {state.label} by <strong>{request.decided_by_name ?? 'an approver'}</strong>
          {request.decided_on_behalf_of_name ? <> on behalf of <strong>{request.decided_on_behalf_of_name}</strong></> : null} on {formatDateTime(request.decided_at)}
          {request.decision_comment ? `: ${request.decision_comment}` : '.'}
        </Text>
      )}
      {pending && wf && (
        <Text size="sm" c="dimmed">
          Approval workflow "{wf.name}": {wf.approvals} of {wf.required} {wf.required === 1 ? 'approval' : 'approvals'}
          {wf.waiting_for.length ? `, waiting for ${wf.waiting_for.join(', ')}.` : '. Nobody can approve it yet: an administrator can reassign the step or cancel the workflow.'}
          {!showAsset && wf.can_decide ? ' Decide it in the approval panel at the top of this page.' : ''}
        </Text>
      )}
      {pending && (
        <Group gap="xs" mt={4}>
          {(wf ? wf.can_decide && showAsset : can('assets.approve') && !request.own) && (
            <>
              <Button variant="primary" size="sm" icon="check" onClick={() => setDeciding('approve')}>Approve</Button>
              <Button variant="danger" size="sm" icon="x" onClick={() => setDeciding('refuse')}>Refuse</Button>
            </>
          )}
          {can('assets.edit') && <Button size="sm" loading={busy} onClick={() => void withdraw()}>Withdraw request</Button>}
          {request.own && <Text size="sm" c="dimmed">You asked for this, so someone else must decide it.</Text>}
          {!wf && !request.own && !can('assets.approve') && <Text size="sm" c="dimmed">Waiting for someone with the approval permission.</Text>}
        </Group>
      )}
      {deciding && <DecideDialog request={request} label={label} decision={deciding} onClose={(changed) => { setDeciding(null); if (changed) onChanged(); }} />}
    </Paper>
  );
}

const DISPOSAL = ['disposal_approved_by', 'disposal_approved_on', 'disposal_approval_ref', 'disposal_method', 'disposed_on'];

export function DisposalTab({ row, version, onChanged }: { row: Row; version: number; onChanged: () => void }) {
  const funder = useFunder();
  const { data, error, reload } = useFetch<DisposalRequest[]>(`/api/assets/${row.id}/disposal-requests?v=${version}`);
  const state: string | null = row.disposal_request_status ?? null;
  const gone = row.status === 'disposed';
  const current = gone ? 'done' : state === 'approved' ? 'dispose' : state === 'pending' ? 'decide' : 'ask';
  return (
    <div className="stack">
      <Card title="How disposal works">
        <Stepper label="Disposal steps" current={current} steps={[
          { key: 'ask', label: 'Request approval', hint: 'Select Dispose and say why' },
          { key: 'decide', label: 'Approver decides', hint: 'Someone other than the requester', state: state === 'refused' && !gone ? 'blocked' : undefined },
          { key: 'dispose', label: 'Mark as disposed', hint: 'Method and date are recorded' },
          { key: 'done', label: 'Disposed' },
        ]} />
        <Text size="sm" c="dimmed">
          Every disposal needs an approval: who approved it and when. Ask for it with the Dispose button; the "Asset disposal"
          approval workflow tells the people who may approve (with a second step when an outside funder keeps an interest),
          and the one who asked cannot approve it. An approval given outside the application can be recorded
          as a name and date instead, unless your organization has switched that off.
        </Text>
        {!funder.on ? null : row.funder_interest ? (
          <Callout color={gone ? 'gray' : 'amber'} title={`${funder.label}: the disposal rule applies to this asset`}>
            An outside funder paid for {row.funder_interest_pct != null ? `${row.funder_interest_pct}% of` : 'part of'} this asset and keeps an
            interest in it. As well as the approval above, the reference of the funder's own approval (a letter or email reference)
            must be entered before the asset can be marked as disposed. The rule holds however the status is changed, and a blocked attempt is kept in the history.
          </Callout>
        ) : (
          <Text size="sm" c="dimmed">No {funder.label.toLowerCase()} is recorded for this asset, so no funder approval reference is needed.</Text>
        )}
        {state === 'refused' && !gone && <Callout color="red" title="The last request was refused">Read the approver's comment below. A new request can be made with the Dispose button.</Callout>}
      </Card>
      <Card title="Approval requests">
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={3} />
          : data.length === 0 ? <EmptyState icon="check-square" title="No approval has been requested" message="A request made with the Dispose button, and the approver's decision, are kept here." />
          : <div className="stack">{data.map((r) => <RequestCard key={r.id} request={r} label={row.tag ?? row.name} onChanged={() => { reload(); onChanged(); }} />)}</div>}
      </Card>
      <EditableSummary type="asset" row={row} fields={DISPOSAL} title="Disposal record" editable={false} />
    </div>
  );
}
