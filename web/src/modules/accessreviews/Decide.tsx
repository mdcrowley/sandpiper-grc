// One system in an access review (E41-02): the reviewer keeps or removes each account, then signs the
// system off. Open to the named reviewer even without permission to view systems, and to anyone who
// may view systems (read only). Also the reviewer's list of systems to review ("My access reviews").
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, Modal, Notice, PageHeader,
  ProgressBar, StatusChip, TableWrap, TextArea, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { AttentionChip } from './Accounts';
import { AccessTabs } from './shared';

interface Item extends Row {
  account_name: string; display_name: string | null; holder_name: string | null; holder_status: string | null; role_on_system: string | null;
  privileged: boolean; last_seen_on: string | null; attention: string | null; attention_now: string | null; decision: 'keep' | 'remove' | null;
  comment: string | null; decided_by_name: string | null; decided_at: string | null; removal_status: string | null; own: boolean; mayDecide: boolean;
}
interface Page {
  review: { id: string; ref: string | null; title: string; status: string; due_on: string | null; owner_id: string | null; description: string | null };
  system: { id: string; ref: string | null; name: string; reviewer_id: string | null; signed_off_at: string | null };
  isReviewer: boolean; mayManage: boolean; items: Item[];
}

function DecisionChip({ item }: { item: Item }) {
  if (item.decision === 'keep') return <StatusChip color="green" label="Keep" />;
  if (item.decision === 'remove') return <StatusChip color="red" label={item.removal_status === 'done' ? 'Removed' : 'Remove'} />;
  return <span className="muted">Not decided</span>;
}

export function DecidePage() {
  const { id, systemId } = useParams();
  const toast = useToast();
  const { data, error, reload } = useFetch<Page>(`/api/access-reviews/${id}/systems/${systemId}/items`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<null | { decision: 'keep' | 'remove'; items: Item[] }>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const decidable = useMemo(() => (data?.items ?? []).filter((i) => i.mayDecide), [data]);

  if (error) return <div className="stack"><PageHeader title="Access review" /><Card><ErrorState error={error} onRetry={reload} /></Card></div>;
  if (!data) return <div className="stack"><PageHeader title="Access review" /><Card><Loading lines={6} label="Loading the accounts" /></Card></div>;

  const { review, system, items } = data;
  const open = review.status === 'in_progress' && !system.signed_off_at;
  const decided = items.filter((i) => i.decision).length;
  const leaverKeep = (list: Item[]) => list.some((i) => (i.attention_now === 'leaver' || i.attention === 'leaver') && !i.comment);

  const decide = async (decision: 'keep' | 'remove' | null, list: Item[], note = '') => {
    setBusy(true);
    try {
      await api.post(`/api/access-reviews/${review.id}/decisions`, { items: list.map((i) => i.id), decision, comment: note });
      setSelected(new Set());
      setAsking(null);
      setComment('');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const ask = (decision: 'keep' | 'remove', list: Item[]) => {
    // A comment is needed to keep a leaver's account, and is offered for every removal.
    if (decision === 'remove' || leaverKeep(list)) { setComment(''); setAsking({ decision, items: list }); } else void decide(decision, list);
  };
  const signOff = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ removals: number; due_on: string }>(`/api/access-reviews/${review.id}/systems/${system.id}/sign-off`, {});
      toast.success(res.removals ? `Signed off. ${res.removals} removal${res.removals === 1 ? '' : 's'} to be done by ${formatDate(res.due_on)}.` : 'Signed off.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setSigning(false); }
  };
  const toggle = (itemId: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(itemId); else n.delete(itemId); return n; });
  const chosen = decidable.filter((i) => selected.has(i.id));

  return (
    <div className="stack">
      <PageHeader
        title={`Accounts on ${system.name}`}
        reference={review.ref ?? undefined}
        subtitle={`${review.title}${review.due_on ? `; decisions due ${formatDate(review.due_on)}` : ''}`}
        status={system.signed_off_at ? <StatusChip color="green" label="Signed off" /> : <LookupChip list="access_review_status" value={review.status} />}
        breadcrumbs={[{ label: 'My access reviews', to: '/access-reviews/mine' }, { label: system.name }]}
        actions={data.isReviewer && open ? (
          <Button variant="primary" icon="check" disabled={decided < items.length} loading={busy} onClick={() => setSigning(true)}>Sign off</Button>
        ) : undefined}
      />
      {review.description && <Notice tone="info" title="Instructions">{review.description}</Notice>}
      {data.isReviewer && open && (
        <Notice tone="neutral">
          Keep each account the person still needs, with the role shown; remove the others. Accounts whose holder has left or is on leave are listed first.
          Your own account, if listed, is decided by the campaign owner. Sign off once every account is decided.
        </Notice>
      )}
      <Card title={`Accounts (${items.length})`} flush
        actions={<ProgressBar value={decided} max={Math.max(1, items.length)} label="Accounts decided" hideLabel valueText={`${decided} of ${items.length} decided`} size="sm" className="ar-progress" />}>
        {chosen.length > 0 && (
          <div className="ar-bulk" role="region" aria-label="Selected accounts">
            <span>{chosen.length} selected</span>
            <Button size="sm" icon="check" loading={busy} onClick={() => ask('keep', chosen)}>Keep</Button>
            <Button size="sm" variant="danger" icon="x" loading={busy} onClick={() => ask('remove', chosen)}>Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
        {items.length === 0 ? <EmptyState icon="key" title="No accounts" message="The system had no active accounts when the review began." /> : (
          <TableWrap label={`Accounts on ${system.name}`} fit>
            <table className="table">
              <caption className="sr-only">Accounts on {system.name}</caption>
              <thead>
                <tr>
                  {decidable.length > 0 && open && (
                    <th scope="col" data-priority="1">
                      <Checkbox label="Select every account you may decide on" className="ar-hide-label"
                        checked={chosen.length === decidable.length && decidable.length > 0}
                        onChange={(on) => setSelected(on ? new Set(decidable.map((i) => i.id)) : new Set())} />
                    </th>
                  )}
                  <th scope="col" data-priority="1">Account</th>
                  <th scope="col" data-priority="2">Holder</th>
                  <th scope="col" data-priority="2">Role</th>
                  <th scope="col" data-priority="3">Last seen</th>
                  <th scope="col" data-priority="1">Decision</th>
                  {open && <th scope="col" data-priority="1"><span className="sr-only">Decide</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    {decidable.length > 0 && open && (
                      <td>{i.mayDecide && <Checkbox label={`Select ${i.account_name}`} className="ar-hide-label" checked={selected.has(i.id)} onChange={(on) => toggle(i.id, on)} />}</td>
                    )}
                    <td className="ar-wrap">
                      <strong>{i.account_name}</strong>
                      {i.privileged && <> <StatusChip color="purple" label="Privileged" size="sm" /></>}
                      <div><AttentionChip value={i.attention_now ?? i.attention} /></div>
                    </td>
                    <td className="ar-wrap">
                      {i.holder_name ?? i.display_name ?? <span className="muted">Unknown</span>}
                      {i.own && <div className="muted">Your own account</div>}
                    </td>
                    <td className="ar-wrap">{i.role_on_system ?? <span className="muted">—</span>}</td>
                    <td>{i.last_seen_on ? formatDate(i.last_seen_on) : <span className="muted">Never</span>}</td>
                    <td className="ar-wrap">
                      <DecisionChip item={i} />
                      {i.decided_by_name && <div className="muted ar-small">{i.decided_by_name}</div>}
                      {i.comment && <div className="ar-small">{i.comment}</div>}
                    </td>
                    {open && (
                      <td>
                        {i.mayDecide && (
                          <div className="row ar-decide">
                            <Button size="sm" variant={i.decision === 'keep' ? 'primary' : 'secondary'} aria-pressed={i.decision === 'keep'} loading={busy}
                              onClick={() => ask('keep', [i])} aria-label={`Keep ${i.account_name}`}>Keep</Button>
                            <Button size="sm" variant={i.decision === 'remove' ? 'danger' : 'secondary'} aria-pressed={i.decision === 'remove'} loading={busy}
                              onClick={() => ask('remove', [i])} aria-label={`Remove ${i.account_name}`}>Remove</Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {data.mayManage && <p className="muted"><Link to={`/access-reviews/${review.id}`}>Open the whole review</Link></p>}
      <Modal open={!!asking} size="sm" onClose={() => setAsking(null)}
        title={asking?.decision === 'remove' ? `Remove ${asking.items.length === 1 ? asking.items[0].account_name : `${asking.items.length} accounts`}?` : 'Keep an account whose holder has left?'}
        footer={(
          <div className="row ar-dialog-buttons">
            <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant={asking?.decision === 'remove' ? 'danger' : 'primary'} loading={busy}
              disabled={asking?.decision === 'keep' && !comment.trim()}
              onClick={() => asking && decide(asking.decision, asking.items, comment)}>{asking?.decision === 'remove' ? 'Remove' : 'Keep'}</Button>
          </div>
        )}>
        <div className="stack">
          {asking?.decision === 'remove'
            ? <p>Once you sign the system off, the removal is passed to the system's technical owner with a due date.</p>
            : <p>The holder is recorded as having left. Say why the account should stay (for example, it is being handed over).</p>}
          <TextArea label={asking?.decision === 'remove' ? 'Comment (optional)' : 'Why it stays'} value={comment} onChange={setComment} rows={3} required={asking?.decision === 'keep'} />
        </div>
      </Modal>
      <ConfirmDialog open={signing} title={`Sign off ${system.name}?`}
        message={`Your ${items.length} decision${items.length === 1 ? '' : 's'} become final. Accounts to remove are passed on with a due date.`}
        confirmLabel="Sign off" cancelLabel="Not now" busy={busy} onConfirm={signOff} onCancel={() => setSigning(false)} />
    </div>
  );
}

interface Mine { review_id: string; ref: string | null; title: string; status: string; due_on: string | null; system_id: string; system_name: string | null; signed_off_at: string | null; total: number; decided: number }

export function MinePage() {
  const { user } = useAuth();
  const { data, error, reload } = useFetch<Mine[]>(user ? '/api/access-reviews/mine' : null);
  return (
    <div className="stack">
      <PageHeader title="My access reviews" subtitle="Systems whose accounts you are asked to keep or remove." />
      <AccessTabs active="mine" />
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} label="Loading your reviews" /> : data.length === 0 ? (
          <EmptyState icon="check-circle" title="Nothing to review" message="When a review asks you to check the accounts on a system, it is listed here." />
        ) : (
          <TableWrap label="Systems you are asked to review" fit>
            <table className="table">
              <caption className="sr-only">Systems you are asked to review</caption>
              <thead><tr>
                <th scope="col" data-priority="1">System</th><th scope="col" data-priority="2">Review</th><th scope="col" data-priority="1">Due</th>
                <th scope="col" data-priority="1">Progress</th><th scope="col" data-priority="2">Signed off</th>
              </tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={`${m.review_id}-${m.system_id}`}>
                    <td className="ar-wrap"><Link to={`/access-reviews/${m.review_id}/systems/${m.system_id}`}>{m.system_name ?? 'System'}</Link></td>
                    <td className="ar-wrap">{m.ref && <span className="ref">{m.ref}</span>} {m.title}</td>
                    <td>{m.due_on ? formatDate(m.due_on) : '—'}</td>
                    <td><ProgressBar value={m.decided} max={Math.max(1, m.total)} label={`Decided on ${m.system_name ?? 'system'}`} hideLabel valueText={`${m.decided} of ${m.total}`} size="sm" /></td>
                    <td>{m.signed_off_at ? formatDate(m.signed_off_at) : <span className="muted">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
