// E45-28 to E45-32: one-click paths out of a ticket. Raise a security incident or a change from it, link it to a
// problem (or create the problem), or mark it as a duplicate of another ticket. Each creates or finds
// the other record on the server and links the two, so both pages show the link.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, Checkbox, errorMessage, LookupSelect, Modal, Notice, RecordPicker, TextArea, TextField, useAuth, useResource, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { fieldErrors } from './util';

type Kind = null | 'incident' | 'change' | 'problem' | 'duplicate';

interface MenuItem { label: string; onSelect: () => void; separated?: boolean }

interface Suggestion { id: string; ref: string; title: string; status: string }

/** The escalation entries for the ticket's "More actions" menu, and their dialogs. */
export function useEscalations(rec: RecordContext, done: boolean): { items: MenuItem[]; dialogs: ReactNode } {
  const { row, reload } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const incidents = useResource('security_incident');
  const changes = useResource('change');
  const [kind, setKind] = useState<Kind>(null);
  const [f, setF] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState<Suggestion[]>([]);
  const set = (key: string) => (value: unknown) => setF((old) => ({ ...old, [key]: value }));

  // Likely originals for "Mark as duplicate of": open or recent tickets that share words with the title.
  useEffect(() => {
    if (kind !== 'duplicate') return;
    let stale = false;
    api.get<{ tickets: Suggestion[] }>(`/api/tickets/suggest?title=${encodeURIComponent(row.title ?? '')}&exclude=${row.id}`)
      .then((r) => { if (!stale) setSuggested(r.tickets ?? []); }, () => { if (!stale) setSuggested([]); });
    return () => { stale = true; };
  }, [kind, row.id, row.title]);

  function open(k: Kind, start: Record<string, unknown>) {
    setF(start);
    setErrors({});
    setKind(k);
  }

  async function run(url: string, body: Record<string, unknown>, after: (res: Row) => void) {
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<Row>(url, body);
      setKind(null);
      after(res);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const items: MenuItem[] = [
    ...(incidents && can('security.create') ? [{
      label: 'Raise a security incident', separated: true,
      onSelect: () => open('incident', { title: row.title ?? '', severity: '' }),
    }] : []),
    ...(changes && can('changes.create') ? [{
      label: 'Raise a change', separated: !(incidents && can('security.create')),
      onSelect: () => open('change', { title: row.title ?? '' }),
    }] : []),
    {
      label: row.problem_id ? 'Change the problem' : 'Link to a problem', separated: !(incidents && can('security.create')) && !(changes && can('changes.create')),
      onSelect: () => open('problem', { problem_id: row.problem_id ?? null, create: false, title: row.title ?? '', description: row.description ?? '' }),
    },
    ...(!done ? [{ label: 'Mark as duplicate of…', onSelect: () => open('duplicate', { of_id: null }) }] : []),
  ];

  const footer = (label: string, onSave: () => void) => (
    <><Button onClick={() => setKind(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={onSave}>{label}</Button></>
  );
  const carried = 'The title, description, requester and affected system or asset are copied, and the two records are linked.';

  const dialogs = (
    <>
      <Modal open={kind === 'incident'} title="Raise a security incident" onClose={() => setKind(null)}
        footer={footer('Raise incident', () => run(`/api/tickets/${row.id}/security-incident`, { title: f.title, severity: f.severity || undefined }, (res) => {
          toast.success(`Security incident ${res.ref} raised and linked to this ticket.`);
          navigate(res.route);
        }))}>
        <div className="stack">
          <p className="muted">{carried} The incident is recorded as reported, discovered when this ticket was opened; declare it on the incident page to start the notification clocks.</p>
          <TextField label="Title" required value={f.title ?? ''} onChange={set('title')} error={errors.title} />
          <LookupSelect label="Severity" list="security_incident_severity" value={f.severity ?? ''} onChange={set('severity')} error={errors.severity}
            hint="Leave empty for the default. You can change it on the incident." />
        </div>
      </Modal>

      <Modal open={kind === 'change'} title="Raise a change" onClose={() => setKind(null)}
        footer={footer('Raise change', () => run(`/api/tickets/${row.id}/change`, { title: f.title }, (res) => {
          toast.success(`Draft change ${res.ref} raised. Complete the plan and submit it.`);
          navigate(res.route);
        }))}>
        <div className="stack">
          <p className="muted">{carried} The change starts as a draft and is linked as the fix for this ticket.</p>
          <TextField label="Title" required value={f.title ?? ''} onChange={set('title')} error={errors.title} />
        </div>
      </Modal>

      <Modal open={kind === 'problem'} title={f.create ? 'Create a problem from this ticket' : 'Link to a problem'} onClose={() => setKind(null)}
        footer={footer(f.create ? 'Create problem' : 'Link', () => {
          if (!f.create && !f.problem_id) { setErrors({ problem_id: 'Choose a problem, or create a new one.' }); return; }
          run(`/api/tickets/${row.id}/problem`, f.create ? { title: f.title, description: f.description } : { problem_id: f.problem_id }, (res) => {
            toast.success(res.created ? `Problem ${res.ref} created and linked.` : `Linked to problem ${res.ref}.`);
            reload();
          });
        })}>
        <div className="stack">
          {can('tickets.create') && (
            <Checkbox label="Create a new problem from this ticket" checked={!!f.create} onChange={set('create')} />
          )}
          {f.create ? (
            <>
              <TextField label="Title" required value={f.title ?? ''} onChange={set('title')} error={errors.title} />
              <TextArea label="Description" rows={4} value={f.description ?? ''} onChange={set('description')} error={errors.description}
                hint="The ticket's reference and requester are added when this is left as the ticket's description." />
            </>
          ) : (
            <RecordPicker label="Problem" type="problem" value={f.problem_id ?? null} display={row._display?.problem_id}
              onChange={(id) => set('problem_id')(id)} error={errors.problem_id} />
          )}
        </div>
      </Modal>

      <Modal open={kind === 'duplicate'} title="Mark as duplicate" onClose={() => setKind(null)}
        footer={footer('Mark as duplicate', () => {
          if (!f.of_id) { setErrors({ of_id: 'Choose the ticket this one repeats.' }); return; }
          run(`/api/tickets/${row.id}/duplicate`, { of_id: f.of_id }, (res) => {
            toast.success(`Marked as a duplicate of ${res.of.ref} and resolved.`);
            reload();
          });
        })}>
        <div className="stack">
          <p className="muted">This ticket is resolved with the code Duplicate and linked to the ticket it repeats, where the work goes on.</p>
          {suggested.length > 0 && (
            <Notice tone="info" title="Similar tickets: select one">
              <ul className="sd-dup-list">
                {suggested.map((s) => (
                  <li key={s.id}>
                    <Button size="sm" variant="ghost" onClick={() => setF((old) => ({ ...old, of_id: s.id, of_label: `${s.ref} ${s.title}` }))}>
                      {s.ref} {s.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <RecordPicker label="Duplicate of" type="ticket" value={f.of_id ?? null} display={f.of_label}
            onChange={(id, option) => setF((old) => ({ ...old, of_id: id, of_label: option?.label }))} error={errors.of_id} />
        </div>
      </Modal>
    </>
  );

  return { items, dialogs };
}
