// The acknowledgment kiosk (E29-10): runs on a supervisor's signed-in device (policies.edit). A
// member of staff picks their name, gives their employee number, reads what they are asked to
// acknowledge and confirms. Every acknowledgment records the signed-in supervisor as who recorded it.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, formatDate, Loading, PageHeader, TextField, useFetch,
} from '../../core';
import { PolicyBody } from './shared';

interface KioskPerson { id: string; name: string; position: string | null }
interface Pending {
  person: { id: string; name: string };
  items: { id: string; policy_ref: string; policy_title: string; policy_summary: string | null; version: number; due_on: string | null; body_html: string }[];
}

export function Kiosk() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const people = useFetch<KioskPerson[]>(`/api/policies/kiosk/people${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [person, setPerson] = useState<KioskPerson | null>(null);
  const [number, setNumber] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  // The thank-you screen clears itself, ready for the next person.
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(null), 6000); return () => clearTimeout(t); }, [done]);

  const reset = () => { setPerson(null); setNumber(''); setPending(null); setRead({}); setMessage(''); people.reload(); };

  async function check(e: FormEvent) {
    e.preventDefault();
    if (!person) return;
    setBusy(true); setMessage('');
    try {
      setPending(await api.get<Pending>(`/api/policies/kiosk/pending?person_id=${person.id}&employee_number=${encodeURIComponent(number.trim())}`));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge() {
    if (!person || !pending) return;
    const ids = pending.items.filter((i) => read[i.id]).map((i) => i.id);
    setBusy(true); setMessage('');
    try {
      const res = await api.post<{ acknowledged: number }>('/api/policies/kiosk/acknowledge', { person_id: person.id, employee_number: number.trim(), ack_ids: ids });
      setDone(`Thank you, ${pending.person.name}. ${res.acknowledged} ${res.acknowledged === 1 ? 'document' : 'documents'} acknowledged.`);
      reset();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (done) {
    body = <Card><div className="pol-kiosk-done" role="status"><p>{done}</p><Button variant="primary" onClick={() => setDone(null)}>Next person</Button></div></Card>;
  } else if (pending) {
    const chosen = pending.items.filter((i) => read[i.id]).length;
    body = (
      <div className="stack">
        <Card title={`Hello, ${pending.person.name}`} actions={<Button onClick={reset}>Not you? Start again</Button>}>
          <p>Read each document, tick that you have read and understood it, then acknowledge.</p>
        </Card>
        {pending.items.length === 0 && <Card><EmptyState icon="check-circle" title="Nothing to acknowledge" message="You are up to date." /></Card>}
        {pending.items.map((i) => (
          <Card key={i.id} title={`${i.policy_ref} ${i.policy_title}, version ${i.version}`}>
            <div className="stack">
              {i.due_on && <p className="muted">Please acknowledge by {formatDate(i.due_on)}.</p>}
              <div className="pol-kiosk-text"><PolicyBody html={i.body_html} /></div>
              <Checkbox label="I have read and understood this document" checked={!!read[i.id]} onChange={(v) => setRead((r) => ({ ...r, [i.id]: v }))} />
            </div>
          </Card>
        ))}
        {message && <div className="form-error" role="alert">{message}</div>}
        {pending.items.length > 0 && (
          <div className="form-actions">
            <Button onClick={reset}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!chosen} onClick={() => void acknowledge()}>Acknowledge {chosen || ''}</Button>
          </div>
        )}
      </div>
    );
  } else if (person) {
    body = (
      <Card title={`Hello, ${person.name}`}>
        <form className="form" onSubmit={check} noValidate>
          {message && <div className="form-error" role="alert">{message}</div>}
          <TextField label="Your employee number" value={number} onChange={setNumber} autoComplete="off" required />
          <div className="form-actions">
            <Button onClick={reset}>Back</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!number.trim()}>Continue</Button>
          </div>
        </form>
      </Card>
    );
  } else {
    let list;
    if (people.error) list = <ErrorState error={people.error} onRetry={people.reload} />;
    else if (!people.data) list = <Loading lines={4} label="Loading names" />;
    else if (!people.data.length) list = <EmptyState icon="check-circle" title={query ? 'No match' : 'Nobody has anything to acknowledge'} message={query ? 'Check the spelling, or ask your supervisor.' : 'Everyone on the roster is up to date.'} />;
    else {
      list = (
        <ul className="pol-kiosk-names">
          {people.data.map((p) => (
            <li key={p.id}><button type="button" className="pol-kiosk-name" onClick={() => setPerson(p)}><span>{p.name}</span>{p.position && <span className="muted">{p.position}</span>}</button></li>
          ))}
        </ul>
      );
    }
    body = (
      <Card title="Find your name">
        <div className="stack">
          <TextField label="Your name" value={q} onChange={setQ} placeholder="Start typing your name" autoComplete="off" />
          {list}
        </div>
      </Card>
    );
  }

  return (
    <div className="stack pol-kiosk">
      <PageHeader title="Acknowledgment kiosk" subtitle="For staff on the roster: pick your name, give your employee number and acknowledge the documents you are asked to read." />
      {body}
    </div>
  );
}
