// "My approvals": service requests and changes waiting for my decision, decided in one tap.
import { useState } from 'react';
import { api, Button, errorMessage, Icon, TextArea, useFetch, useToast } from '../../core';
import { useI18n } from '../../core/i18n';
import { Section, usePortal } from './parts';

interface TicketApproval {
  id: string; ref: string; title: string; requester_name: string | null; requester_department: string | null;
  opened_at: string; item_name: string | null; catalog_answers: { label: string; value: string }[];
  approvals_needed?: number; approvals_given?: number;
}
interface ChangeApproval { id: string; ref: string; title: string; planned_start: string | null; risk_level: string | null; retrospective: boolean }

interface Pending { key: string; kind: 'request' | 'change'; id: string; ref: string; title: string; lines: string[] }

function Decide({ item, onDone }: { item: Pending; onDone: () => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const what = { ref: item.ref };
  const kindKey = item.kind === 'change' ? 'change' : 'request';

  async function decide(decision: 'approved' | 'rejected') {
    if (decision === 'rejected' && !note.trim()) { setError(t('portal.approvals.sayWhy')); return; }
    setBusy(true);
    try {
      if (item.kind === 'request') await api.post(`/api/tickets/${item.id}/approval`, { decision, note: note.trim() || undefined });
      else await api.post(`/api/changes/${item.id}/approvals`, { decision, notes: note.trim() || undefined });
      toast.success(decision === 'approved' ? t('portal.approvals.approved', what) : t('portal.approvals.rejected', what));
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
          <span className="muted">{t(`portal.approvals.${kindKey}Ref`, what)}</span>
        </div>
      </div>
      {item.lines.length > 0 && <ul className="pt-approval-lines">{item.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {rejecting && (
        <TextArea label={t('portal.approvals.whyLabel')} value={note} onChange={(v) => { setNote(v); setError(''); }} error={error} rows={2} />
      )}
      <div className="pt-approval-buttons">
        {!rejecting ? (
          <>
            <Button variant="primary" icon="check" loading={busy} aria-label={t(`portal.approvals.approve_${kindKey}`, what)} onClick={() => void decide('approved')}>{t('portal.approvals.approve')}</Button>
            <Button variant="secondary" icon="x" disabled={busy} aria-label={t(`portal.approvals.reject_${kindKey}`, what)} onClick={() => setRejecting(true)}>{t('portal.approvals.reject')}</Button>
          </>
        ) : (
          <>
            <Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>{t('portal.approvals.reject')}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setNote(''); setError(''); }}>{t('common.cancel')}</Button>
          </>
        )}
      </div>
    </li>
  );
}

export function Approvals() {
  const { has } = usePortal();
  const { t, date } = useI18n();
  const tickets = useFetch<{ rows: TicketApproval[] }>(has.ticket_approvals ? '/api/portal/approvals' : null);
  const changes = useFetch<{ rows: ChangeApproval[] }>(has.changes ? '/api/changes/waiting' : null);
  if ((has.ticket_approvals && !tickets.data && !tickets.error) || (has.changes && !changes.data && !changes.error)) return null;
  const items: Pending[] = [
    ...(tickets.data?.rows ?? []).map((r): Pending => ({
      key: `t${r.id}`, kind: 'request', id: r.id, ref: r.ref, title: r.title,
      lines: [
        r.requester_department
          ? t('portal.approvals.askedByIn', { name: r.requester_name ?? t('portal.approvals.someone'), department: r.requester_department, date: date(r.opened_at) })
          : t('portal.approvals.askedBy', { name: r.requester_name ?? t('portal.approvals.someone'), date: date(r.opened_at) }),
        ...((r.approvals_needed ?? 1) > 1 ? [t('portal.approvals.needs', { needed: r.approvals_needed ?? 1, given: r.approvals_given ?? 0 })] : []),
        ...r.catalog_answers.slice(0, 4).map((a) => `${a.label}: ${a.value}`),
      ],
    })),
    ...(changes.data?.rows ?? []).map((c): Pending => ({
      key: `c${c.id}`, kind: 'change', id: c.id, ref: c.ref, title: c.title,
      lines: [c.planned_start ? t('portal.approvals.plannedFor', { date: date(c.planned_start) }) : t('portal.approvals.noDate'), ...(c.retrospective ? [t('portal.approvals.started')] : [])],
    })),
  ];
  const reload = () => { tickets.reload(); changes.reload(); };
  return (
    <Section id="pt-approvals" title={t('portal.approvals.title')}>
      {items.length
        ? <ul className="pt-approvals">{items.map((i) => <Decide key={i.key} item={i} onDone={reload} />)}</ul>
        : <p className="muted pt-none">{t('portal.approvals.none')}</p>}
    </Section>
  );
}
