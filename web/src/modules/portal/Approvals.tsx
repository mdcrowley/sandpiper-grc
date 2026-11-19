// "My approvals": service requests and changes waiting for my decision, decided in one tap.
import { useState } from 'react';
import { api, Button, errorMessage, formatDate, Icon, TextArea, useFetch, useToast } from '../../core';
import { Section, usePortal } from './parts';

interface TicketApproval {
  id: string; ref: string; title: string; requester_name: string | null; requester_department: string | null;
  opened_at: string; item_name: string | null; catalog_answers: { label: string; value: string }[];
}
interface ChangeApproval { id: string; ref: string; title: string; planned_start: string | null; risk_level: string | null; retrospective: boolean }

interface Pending { key: string; kind: 'request' | 'change'; id: string; ref: string; title: string; lines: string[] }

function Decide({ item, onDone }: { item: Pending; onDone: () => void }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !note.trim()) { setError('Say why, so the person knows what to do next.'); return; }
    setBusy(true);
    try {
      if (item.kind === 'request') await api.post(`/api/tickets/${item.id}/approval`, { decision, note: note.trim() || undefined });
      else await api.post(`/api/changes/${item.id}/approvals`, { decision, notes: note.trim() || undefined });
      toast.success(decision === 'approved' ? `Approved: ${item.ref}` : `Rejected: ${item.ref}`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="pt-approval">
      <div className="pt-approval-head">
        <Icon name={item.kind === 'change' ? 'refresh' : 'check-square'} size={20} />
        <div>
          <strong>{item.title}</strong>
          <span className="muted">{item.kind === 'change' ? 'Change' : 'Request'} {item.ref}</span>
        </div>
      </div>
      {item.lines.length > 0 && <ul className="pt-approval-lines">{item.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {rejecting && (
        <TextArea label="Why are you rejecting it?" value={note} onChange={(v) => { setNote(v); setError(''); }} error={error} rows={2} />
      )}
      <div className="pt-approval-buttons">
        {!rejecting ? (
          <>
            <Button variant="primary" icon="check" loading={busy} onClick={() => void decide('approved')}>Approve</Button>
            <Button variant="secondary" icon="x" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
          </>
        ) : (
          <>
            <Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>Reject</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setNote(''); setError(''); }}>Cancel</Button>
          </>
        )}
      </div>
    </li>
  );
}

export function Approvals() {
  const { has } = usePortal();
  const tickets = useFetch<{ rows: TicketApproval[] }>(has.ticket_approvals ? '/api/portal/approvals' : null);
  const changes = useFetch<{ rows: ChangeApproval[] }>(has.changes ? '/api/changes/waiting' : null);
  if ((has.ticket_approvals && !tickets.data && !tickets.error) || (has.changes && !changes.data && !changes.error)) return null;
  const items: Pending[] = [
    ...(tickets.data?.rows ?? []).map((t): Pending => ({
      key: `t${t.id}`, kind: 'request', id: t.id, ref: t.ref, title: t.title,
      lines: [
        `Asked by ${t.requester_name ?? 'someone'}${t.requester_department ? ` (${t.requester_department})` : ''} on ${formatDate(t.opened_at)}`,
        ...t.catalog_answers.slice(0, 4).map((a) => `${a.label}: ${a.value}`),
      ],
    })),
    ...(changes.data?.rows ?? []).map((c): Pending => ({
      key: `c${c.id}`, kind: 'change', id: c.id, ref: c.ref, title: c.title,
      lines: [c.planned_start ? `Planned for ${formatDate(c.planned_start)}` : 'No date planned yet', ...(c.retrospective ? ['Work has already started'] : [])],
    })),
  ];
  const reload = () => { tickets.reload(); changes.reload(); };
  return (
    <Section id="pt-approvals" title="My approvals">
      {items.length
        ? <ul className="pt-approvals">{items.map((i) => <Decide key={i.key} item={i} onDone={reload} />)}</ul>
        : <p className="muted pt-none">Nothing is waiting for your approval.</p>}
    </Section>
  );
}
