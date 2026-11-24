import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Icon, IconButton, Loading, LookupChip, RecordPage, relativeTime,
  useAuth, useFetch, useMeta, UserPicker, useToast,
} from '../../core';
import type { RecordContext, RecordTab, Row } from '../../core';
import { ActionStatus } from './ActionStatus';
import { ExtensionDialog } from './ExtensionDialog';
import { VerifyDialog } from './VerifyDialog';
import './caps.css';
import { DueChip } from './scales';

// The Work tracker tab (E36-06), from the feeds module when it is part of the build.
const useTrackerTab = Object.values(import.meta.glob<{ useTrackerTab: (type: string) => RecordTab | null }>('../feeds/TrackerLinkPanel.tsx', { eager: true }))[0]?.useTrackerTab ?? (() => null);

interface Shares { restricted: boolean; shares: { user_id: string; name: string; shared_by: string | null; created_at: string }[] }

/**
 * Who a restricted action has been shared with by name. Sharing lets one person who cannot see
 * restricted records see this one action (in "My actions") and change its status and notes.
 */
function SharingPanel({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Shares>(`/api/actions/${rec.row.id}/shares`);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const made = await api.post<{ name: string }>(`/api/actions/${rec.row.id}/shares`, { user_id: userId });
      toast.success(`Shared with ${made.name}.`);
      setUserId(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const stop = async (id: string, name: string) => {
    try {
      await api.del(`/api/actions/${rec.row.id}/shares/${id}`);
      toast.success(`No longer shared with ${name}.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card title="Sharing">
      <div className="notice">
        <Icon name="lock" size={18} />
        <div>
          <strong>This action is restricted</strong>
          <p>
            It arose from a restricted record, so only people with access to security records can see it. Share it with a named person
            (for example its owner) and they will see this one action under “My actions”, with its title, description, due date and notes,
            and can change its status and notes. They never see the record it arose from.
          </p>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} label="Loading sharing" /> : (
        <>
          {data.shares.length === 0 ? <EmptyState icon="users" title="Not shared with anyone" message="Only people with access to security records can see this action." /> : (
            <ul className="rk-share-list">
              {data.shares.map((s) => (
                <li key={s.user_id}>
                  <Icon name="user" size={16} />
                  <span><strong>{s.name}</strong> <span className="muted">shared {relativeTime(s.created_at)}{s.shared_by ? ` by ${s.shared_by}` : ''}</span></span>
                  {rec.canEdit && <IconButton size="sm" icon="x" label={`Stop sharing with ${s.name}`} onClick={() => void stop(s.user_id, s.name)} />}
                </li>
              ))}
            </ul>
          )}
          {rec.canEdit && (
            <div className="rk-share-add">
              <UserPicker label="Share with" placeholder="Search people" value={userId} display={rec.row.owner_id === userId ? rec.row._display?.owner_id : undefined} onChange={(id) => setUserId(id)} />
              {rec.row.owner_id && !data.shares.some((s) => s.user_id === rec.row.owner_id) && userId !== rec.row.owner_id && (
                <Button variant="ghost" onClick={() => setUserId(rec.row.owner_id)}>Choose the owner</Button>
              )}
              <Button variant="primary" loading={busy} disabled={!userId} onClick={share}>Share</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

interface Extensions {
  available: boolean; original_due_on: string | null; extension_count: number;
  requests: {
    id: string; status: string; requested_on: string; old_due_on: string | null; new_due_on: string; reason: string;
    decided_by_name: string | null; decided_on: string | null; decision_note: string | null; requested_by_name: string | null;
  }[];
}

const EXT_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting for a decision', tone: 'amber' }, approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' }, canceled: { label: 'Canceled', tone: 'gray' },
};

/**
 * Verification of effectiveness (E23-03): whether the action needs it, who verifies and by when,
 * the last result, and the button that records it while the action is awaiting verification.
 */
function VerificationPanel({ rec }: { rec: RecordContext }) {
  const { user, can } = useAuth();
  const [open, setOpen] = useState(false);
  const row = rec.row;
  const awaiting = row.status === 'pending_verification';
  const mayVerify = awaiting && can('actions.edit') && (can('actions.approve') || row.verifier_id === user?.id);
  return (
    <Card title="Verification" actions={mayVerify ? <Button size="sm" variant="primary" icon="check-circle" onClick={() => setOpen(true)}>Record verification</Button> : null}>
      {!row.verification_required ? (
        <p className="muted">This action does not need its effectiveness verified: it is finished when it is marked done.</p>
      ) : (
        <div className="stack">
          <p className="muted cap-flush">
            {awaiting
              ? 'The work is finished and waiting for someone to check that it worked. Until then the action stays open.'
              : 'When the work is marked done, the action waits for someone to check that it worked before it counts as done.'}
          </p>
          <dl className="cap-facts">
            <div><dt>Verifier</dt><dd>{row._display?.verifier_id ?? <span className="muted">Not named (the plan's responsible person or an approver)</span>}</dd></div>
            <div><dt>Verification due</dt><dd>{row.verification_due ? formatDate(row.verification_due) : <span className="muted">Set when the work is finished</span>}</dd></div>
            {row.verification_result && (
              <>
                <div><dt>Last result</dt><dd><LookupChip list="verification_result" value={row.verification_result} /></dd></div>
                <div><dt>Method</dt><dd><LookupChip list="verification_method" value={row.verification_method} /></dd></div>
                <div><dt>Verified</dt><dd>{formatDate(row.verified_on)}{row._display?.verified_by ? ` by ${row._display.verified_by}` : ''}</dd></div>
                {row.verification_note && <div className="cap-facts-wide"><dt>Note</dt><dd className="cap-pre">{row.verification_note}</dd></div>}
              </>
            )}
          </dl>
        </div>
      )}
      <VerifyDialog action={row} open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); rec.reload(); }} />
    </Card>
  );
}

/** Due-date extension requests and their decisions (E23-05). */
function ExtensionsPanel({ rec }: { rec: RecordContext }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Extensions>(`/api/actions/${rec.row.id}/extension-requests`);
  const [open, setOpen] = useState(false);
  const finished = Boolean(rec.row.completed_on) || rec.row.status === 'cancelled' || rec.row.status === 'done';
  const pending = data?.requests.some((r) => r.status === 'pending');
  const canAsk = can('actions.edit') && !finished && !pending && Boolean(data?.available);
  return (
    <Card title="Due date extensions" actions={canAsk ? <Button size="sm" icon="calendar" onClick={() => setOpen(true)}>Ask for more time</Button> : null}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} label="Loading extensions" /> : (
        <div className="stack">
          {data.original_due_on && (
            <p className="cap-flush">Originally due <strong>{formatDate(data.original_due_on)}</strong>; extended {data.extension_count === 1 ? 'once' : `${data.extension_count} times`}.</p>
          )}
          {!data.available && !finished && <p className="muted cap-flush">No extension workflow is set up, so only someone who may approve actions can change the due date.</p>}
          {data.requests.length === 0 ? <EmptyState icon="calendar" title="No extensions asked for" message="An owner who needs more time asks here; each decision and its reason are kept." /> : (
            <ul className="cap-ext-list">
              {data.requests.map((r) => (
                <li key={r.id}>
                  <div className="row">
                    <strong>{r.old_due_on ? `${formatDate(r.old_due_on)} to ${formatDate(r.new_due_on)}` : `To ${formatDate(r.new_due_on)}`}</strong>
                    <span className={`chip chip-${EXT_STATUS[r.status]?.tone ?? 'gray'}`}>{EXT_STATUS[r.status]?.label ?? r.status}</span>
                  </div>
                  <span className="cap-pre">{r.reason}</span>
                  <span className="muted">
                    Asked {formatDate(r.requested_on)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}
                    {r.decided_on ? `; decided ${formatDate(r.decided_on)}${r.decided_by_name ? ` by ${r.decided_by_name}` : ''}` : ''}
                    {r.decision_note ? `: ${r.decision_note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ExtensionDialog action={rec.row} open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); rec.reload(); }} />
    </Card>
  );
}

export function ActionDetail() {
  const { resources } = useMeta();
  const { can } = useAuth();
  const trackerTab = useTrackerTab('action');
  const source = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    const plan = row.cap_id ? <> · Part of <Link to={`/caps/${row.cap_id}`}>{row._display?.cap_id ?? 'a corrective action plan'}</Link></> : null;
    if (!target || !row.source_id) {
      if (row.external_ref) return <span className="muted">External reference {row.external_ref}{plan}</span>;
      return plan ? <span>{plan}</span> : null;
    }
    return <span>Arose from <Link to={`${target.route}/${row.source_id}`}>{target.label.toLowerCase()} record</Link>{plan}</span>;
  };
  return (
    <RecordPage
      type="action"
      subtitle={source}
      status={(row) => <ActionStatus key={`${row.id}-${row.status}`} row={row} />}
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div>
            <span className="rk-step-label">Due</span>
            <span className="row">
              <strong>{row.due_on ? formatDate(row.due_on) : 'No due date'}</strong>
              {row.due_on && (row.completed_on || row.status === 'cancelled' ? null : <DueChip date={row.due_on} warnDays={7} />)}
            </span>
          </div>
          <div>
            <span className="rk-step-label">Owner</span>
            <span>{row._display?.owner_id ?? <span className="muted">Unassigned</span>}</span>
          </div>
          <div>
            <span className="rk-step-label">Priority</span>
            <LookupChip list="action_priority" value={row.priority} />
          </div>
          {row.completed_on && (
            <div>
              <span className="rk-step-label">Completed</span>
              <span>{formatDate(row.completed_on)}</span>
            </div>
          )}
          {row.restricted && (
            <div>
              <span className="rk-step-label">Visibility</span>
              <span className="chip chip-purple"><Icon name="lock" size={12} /> Restricted</span>
            </div>
          )}
        </div>
      )}
      summaryFields={['title', 'description', 'status', 'priority', 'owner_id', 'due_on', 'completed_on', 'source', 'department_id', 'site_id', 'external_ref', 'notes', 'cap_id', 'verification_required', 'verifier_id', 'closure_evidence']}
      tabs={[
        { key: 'verification', label: 'Verification', content: (rec: RecordContext) => <VerificationPanel rec={rec} /> },
        { key: 'extensions', label: 'Extensions', content: (rec: RecordContext) => <ExtensionsPanel rec={rec} /> },
        // Offered only to people who can see restricted records; the server checks again.
        ...(can('security.view') ? [{ key: 'sharing', label: 'Sharing', content: (rec: RecordContext) => (rec.row.restricted
          ? <SharingPanel rec={rec} />
          : <Card title="Sharing"><p className="muted">This action is not restricted: everyone who can see the action tracker can see it, so there is nothing to share.</p></Card>) }] : []),
        ...(trackerTab ? [trackerTab] : []),
      ]}
    />
  );
}
