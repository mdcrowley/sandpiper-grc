// Call-tree messages with acknowledgment (E41-14): on an activation, send an activated plan's call
// tree a message by email and text message, and see who has acknowledged and who has not. The public
// page each person opens from their link is CallOutAckPage.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Modal, Notice, ProgressBar, Select,
  StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { Logo } from '../../core/Logo';

interface Recipient {
  id: string; depth: number; role: string | null; name: string | null; reach: 'email' | 'text' | 'both' | 'none';
  email_status: string | null; text_status: string | null;
  acknowledged_at: string | null; ack_via: 'link' | 'staff' | null; ack_by_name: string | null; ack_note: string | null;
}
interface Callout {
  id: string; plan_ref: string | null; plan_title: string | null; message: string; expires_at: string; expired: boolean;
  sent_at: string; sent_by_name: string | null; total: number; acknowledged: number; waiting: number; unreachable: number; recipients: Recipient[];
}

const REACH: Record<Recipient['reach'], string> = { email: 'Email', text: 'Text message', both: 'Email and text', none: 'Not reachable: call them' };
const FAILED = new Set(['failed', 'dead', 'skipped']);

function SendDialog({ activation, onClose, onSent }: { activation: Row; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const ids: string[] = Array.isArray(activation.plan_ids) ? activation.plan_ids : [];
  const plans = useFetch<{ rows: Row[] }>(ids.length ? '/api/continuity-plans?pageSize=500&sort=title' : null);
  const options = (plans.data?.rows ?? []).filter((p) => ids.includes(String(p.id))).map((p) => ({ value: String(p.id), label: `${p.ref} ${p.title}` }));
  const [form, setForm] = useState({ plan_id: '', message: '', email: true, text: true, hours: '72' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const plan = form.plan_id || options[0]?.value || '';
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const send = async () => {
    setBusy(true); setErrors({});
    try {
      const res = await api.post<{ people: number; email: number; text: number; none: number; text_links: boolean }>(
        `/api/emergency-activations/${activation.id}/call-outs`, { plan_id: plan, message: form.message, email: form.email, text: form.text, hours: Number(form.hours) });
      toast.success(`Sent to ${res.people} ${res.people === 1 ? 'person' : 'people'}: ${res.email} by email, ${res.text} by text message${res.none ? `, ${res.none} to call` : ''}.`);
      if (!res.text_links && res.text) toast.error('Text messages went without the link: no application address is set. Ask an administrator to set it under Administration > Email.');
      onSent();
      onClose();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title="Send the call tree a message" onClose={onClose} dirty={Boolean(form.message)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="bell" loading={busy} disabled={!plan} onClick={send}>Send</Button></>}>
      <div className="stack">
        <Select label="Call tree of" required value={plan} error={errors.plan_id} options={options} onChange={(v) => set({ plan_id: v })} />
        <TextArea label="Message" required value={form.message} error={errors.message} rows={4} onChange={(v) => set({ message: v })}
          hint="What is happening and what people should do. A text message carries about the first 200 characters, with the link." />
        <div className="bc-callout-ways">
          <Checkbox label="By email" checked={form.email} onChange={(v) => set({ email: v })} />
          <Checkbox label="By text message" checked={form.text} onChange={(v) => set({ text: v })} />
        </div>
        {errors.email && <Notice tone="error">{errors.email}</Notice>}
        <TextField label="Links work for (hours)" value={form.hours} error={errors.hours} inputMode="numeric" maxLength={3} onChange={(v) => set({ hours: v })} hint="From 1 to 168." />
        <p className="muted bc-small">
          Each person gets a link of their own to say they have received it, without signing in. Email goes to the address of their account or
          roster entry; text messages go to people with an account who have saved a mobile number or email-to-text address. Entries with only a
          typed name and phone are listed for you to call.
        </p>
      </div>
    </Modal>
  );
}

function Delivery({ r }: { r: Recipient }) {
  const failed = [r.email_status, r.text_status].filter((s) => s && FAILED.has(s));
  return (
    <span>
      {REACH[r.reach]}
      {failed.length > 0 && <span className="muted bc-small"> (not delivered)</span>}
    </span>
  );
}

/** The call-tree messages of an activation, with who has acknowledged and who has not. */
export function CallOutsTab({ activation, onChanged }: { activation: Row; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/emergency-activations/${activation.id}/call-outs`;
  const { data, error, reload } = useFetch<{ channels: { email: boolean; text: boolean }; rows: Callout[] }>(url);
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState<{ callout: Callout; r: Recipient } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = can('continuity.edit');
  const active = activation.status === 'active';
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activation.updated_at]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the call-tree messages" />;
  const ready = data.channels.email || data.channels.text;
  const done = () => { reload(); onChanged(); };

  const remind = async (c: Callout) => {
    setBusy(true);
    try {
      const res = await api.post<{ reached: number; waiting: number }>(`${url}/${c.id}/remind`, {});
      toast.success(`Reminder sent to ${res.reached} of ${res.waiting} who had not acknowledged.`);
      done();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const mark = async () => {
    if (!marking) return;
    setBusy(true);
    try {
      await api.post(`${url}/${marking.callout.id}/recipients/${marking.r.id}/acknowledge`, { note });
      setMarking(null); setNote('');
      done();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {canEdit && active && (
        <Card title="Message the call tree">
          {ready ? (
            <div className="row bc-between">
              <p className="muted bc-small">Send an activated plan's call tree a message by email and text message. Each person acknowledges through their own link.</p>
              <Button variant="primary" icon="bell" disabled={!(activation.plan_ids ?? []).length} onClick={() => setSending(true)}>Send a message</Button>
            </div>
          ) : (
            <Notice tone="warning">Neither email nor text messages are set up, so call the people on the call tree. An administrator sets them up under Administration &gt; Email.</Notice>
          )}
        </Card>
      )}
      {data.rows.length === 0 ? (
        <EmptyState icon="bell" title="No messages sent" message={active ? 'Messages sent to a call tree, and who has acknowledged them, are listed here.' : 'No call-tree message was sent during this activation.'} />
      ) : data.rows.map((c) => (
        <Card key={c.id} flush
          title={`${c.plan_ref ?? 'Plan'} call tree · ${formatDateTime(c.sent_at)}`}
          actions={canEdit && active && !c.expired && c.waiting > c.unreachable
            ? <Button size="sm" icon="refresh" loading={busy} onClick={() => void remind(c)}>Remind those who have not acknowledged</Button> : undefined}>
          <div className="bc-pad stack">
            <p className="prose bc-callout-message">{c.message}</p>
            <ProgressBar label="Acknowledged" value={c.acknowledged} max={c.total} color={c.acknowledged === c.total ? 'green' : 'amber'}
              valueText={`${c.acknowledged} of ${c.total} acknowledged${c.waiting ? `, ${c.waiting} not yet` : ''}`} />
            <p className="muted bc-small">
              Sent by {c.sent_by_name ?? 'someone'}. {c.expired ? 'The links have expired.' : `The links work until ${formatDateTime(c.expires_at)}.`}
            </p>
          </div>
          <TableWrap label="Who has acknowledged">
            <table className="table">
              <caption className="sr-only">Who has acknowledged this message</caption>
              <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Reached by</th><th scope="col">Acknowledged</th>{canEdit && activation.status !== 'closed' && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {[...c.recipients].sort((a, b) => Number(Boolean(a.acknowledged_at)) - Number(Boolean(b.acknowledged_at))).map((r) => (
                  <tr key={r.id}>
                    <td>{r.name ?? <span className="muted">Not known</span>}</td>
                    <td>{r.role ?? <span className="muted">—</span>}</td>
                    <td><Delivery r={r} /></td>
                    <td className="bc-wrap">
                      {r.acknowledged_at ? (
                        <>
                          <StatusChip color="green" label={formatDateTime(r.acknowledged_at)} />
                          <div className="muted bc-small">{r.ack_via === 'staff' ? `Recorded by ${r.ack_by_name ?? 'staff'}` : 'Through their link'}{r.ack_note ? `: ${r.ack_note}` : ''}</div>
                        </>
                      ) : <StatusChip color={r.reach === 'none' ? 'red' : 'amber'} label="Not yet" />}
                    </td>
                    {canEdit && activation.status !== 'closed' && (
                      <td className="bc-actions">{!r.acknowledged_at && <Button size="sm" variant="ghost" onClick={() => { setMarking({ callout: c, r }); setNote(''); }}>Record acknowledgment</Button>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ))}
      {sending && <SendDialog activation={activation} onClose={() => setSending(false)} onSent={done} />}
      <Modal open={!!marking} title="Record an acknowledgment" onClose={() => setMarking(null)} dirty={Boolean(note)}
        footer={<><Button onClick={() => setMarking(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={mark}>Record</Button></>}>
        <div className="stack">
          <p>{marking?.r.name ?? 'This person'} acknowledged the message another way, such as by phone. It is written to the log with your name.</p>
          <TextField label="Note" value={note} maxLength={500} onChange={setNote} placeholder="For example: called at 05:10, on the way" />
        </div>
      </Modal>
    </div>
  );
}

interface PublicCallout { organization: string; title: string; message: string; name: string | null; role: string | null; sent_at: string; expires_at: string; acknowledged_at: string | null }

/** The page a person opens from their link: the message, and a button to acknowledge it. No sign-in. */
export function CallOutAckPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicCallout | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api.get<PublicCallout>(`/api/call-out/${encodeURIComponent(token)}`).then(setData, (err) => setFailure(errorMessage(err)));
  }, [token]);
  useEffect(() => { if (data) document.title = `${data.title} · ${data.organization}`; }, [data]);

  if (failure) {
    return <main className="bc-ack" id="main"><h1 className="sr-only">Call-tree message</h1><EmptyState icon="lock" title="This link cannot be opened" message={failure} /></main>;
  }
  if (!data) return <main className="bc-ack" id="main"><h1 className="sr-only">Call-tree message</h1><Loading lines={5} label="Loading the message" /></main>;

  const acknowledge = async () => {
    setBusy(true); setProblem(null);
    try { setData(await api.post<PublicCallout>(`/api/call-out/${encodeURIComponent(token)}`, { note })); }
    catch (err) { setProblem(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <main className="bc-ack" id="main">
      <header className="bc-ack-head">
        <div className="bc-ack-org"><Logo size={28} /> <span>{data.organization}</span></div>
        <h1>{data.title}</h1>
        <p className="muted">Message to {data.name ?? 'you'}{data.role ? `, ${data.role}` : ''}, sent {formatDateTime(data.sent_at)}</p>
      </header>
      <Card title="Message">
        <p className="prose bc-callout-message">{data.message}</p>
      </Card>
      {data.acknowledged_at ? (
        <Notice tone="success" title="Acknowledged">You acknowledged this message at {formatDateTime(data.acknowledged_at)}. The emergency team can see it. You can close this page.</Notice>
      ) : (
        <Card title="Let the team know you have it">
          <div className="stack">
            <TextField label="Note" value={note} maxLength={500} onChange={setNote} placeholder="Optional, for example: on my way, there by 06:00" />
            {problem && <Notice tone="error">{problem}</Notice>}
            <div><Button variant="primary" icon="check" loading={busy} onClick={acknowledge}>I have received this message</Button></div>
            <p className="muted bc-small">This link is meant for you and works until {formatDateTime(data.expires_at)}.</p>
          </div>
        </Card>
      )}
    </main>
  );
}
