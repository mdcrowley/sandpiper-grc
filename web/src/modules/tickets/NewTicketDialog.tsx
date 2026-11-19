// New ticket dialog: IT staff log a ticket on a colleague's behalf. Built to be fast: sensible
// defaults, catalogue shortcuts, likely duplicates and articles while the title is typed, and
// the priority and due times that impact and urgency will give, shown before anything is saved.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SegmentedControl } from '@mantine/core';
import {
  api, Button, Checkbox, DateField, errorMessage, formatDateTime, Icon, LookupChip, LookupSelect, Modal, RecordPicker, Select, TextArea, TextField,
  useAuth, useDebounced, useFetch, useLookup, useResource, UserPicker, useToast,
} from '../../core';
import type { ListResult, Row } from '../../core';
import { fieldErrors, priorityFor, type PriorityMatrix, type Question, type Suggestions } from './util';

export interface NewTicketDialogProps {
  open: boolean;
  onClose: () => void;
  /** `another` is true when the agent chose to log another straight away: the dialog stays open. */
  onCreated: (row: Row, another: boolean) => void;
  /** Starting values, for example `{ catalog_item_id }` from the catalogue or a parent ticket. */
  initial?: Record<string, unknown>;
  title?: string;
}

const START: Record<string, unknown> = { type: 'incident', impact: 'individual', urgency: 'medium', channel: 'agent' };
interface Preview { policy: { calendar_name: string } | null; response_due_at: string | null; resolve_due_at: string | null }

export function NewTicketDialog({ open, onClose, onCreated, initial, title = 'New ticket' }: NewTicketDialogProps) {
  const toast = useToast();
  const { user, can } = useAuth();
  const types = useLookup('ticket_type');
  const hasSystems = !!useResource('system');
  const hasAssets = !!useResource('asset');
  const [v, setV] = useState<Record<string, any>>({ ...START });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [item, setItem] = useState<Row | null>(null);
  const [override, setOverride] = useState(false);
  const [assigneeName, setAssigneeName] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const another = useRef(false);

  const matrix = useFetch<PriorityMatrix>(open ? '/api/tickets/priority-matrix' : null);
  const catalogue = useFetch<ListResult>(open ? '/api/catalog-items?f.active=true&sort=name&pageSize=100' : null);
  const computed = priorityFor(matrix.data, String(v.impact ?? ''), String(v.urgency ?? ''));
  const priority = override ? v.priority : computed;
  const preview = useFetch<Preview>(open && priority ? `/api/tickets/sla/preview?priority=${encodeURIComponent(priority)}` : null);
  const typedTitle = useDebounced(String(v.title ?? '').trim(), 400);
  const suggest = useFetch<Suggestions>(open && typedTitle.length >= 6 ? `/api/tickets/suggest?title=${encodeURIComponent(typedTitle)}` : null);

  function reset(start?: Record<string, unknown>) {
    setV({ ...START, ...(start ?? {}) });
    setAnswers({});
    setItem(null);
    setOverride(false);
    setAssigneeName(undefined);
    setErrors({});
    setFormError('');
  }

  function applyItem(next: Row | null) {
    setItem(next);
    setAnswers({});
    setErrors({});
    setV((old) => {
      // Values the previous item filled in are dropped; what the agent typed elsewhere stays.
      const kept = { ...old };
      for (const key of Object.keys(item?.defaults ?? {})) if (kept[key] === item?.defaults[key]) delete kept[key];
      return { ...START, ...kept, ...(next?.defaults ?? {}), catalog_item_id: next?.id ?? null };
    });
  }

  useEffect(() => {
    if (!open) return;
    const { catalog_item_id: itemId, ...rest } = initial ?? {};
    reset(rest);
    if (!itemId) return;
    api.get<Row>(`/api/catalog-items/${itemId}`).then(applyItem).catch((err) => setFormError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const set = (key: string) => (value: unknown) => setV((old) => ({ ...old, [key]: value }));
  const questions = (item?.questions ?? []) as Question[];

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const found: Record<string, string> = {};
    if (!String(v.title ?? '').trim()) found.title = 'Title is required.';
    if (!v.type) found.type = 'Type is required.';
    if (v.requester_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.requester_email))) found.requester_email = 'Enter a full email address.';
    if (override && !v.priority) found.priority = 'Choose a priority, or untick the box.';
    for (const q of questions) if (q.required && !String(answers[q.key] ?? '').trim()) found[`catalog_answers.${q.key}`] = `${q.label} is required.`;
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError('Check the highlighted fields.');
      return;
    }

    const body: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (val !== '' && val !== null && val !== undefined) body[k] = val;
    if (!override) delete body.priority;
    if (questions.length) body.catalog_answers = answers;
    setBusy(true);
    setFormError('');
    try {
      const row = await api.post<Row>('/api/tickets', body);
      toast.success(`Ticket ${row.ref} logged.`);
      const again = another.current;
      if (again) reset();
      onCreated(row, again);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
      another.current = false;
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
  };

  const footer = (
    <>
      <span className="sd-footer-hint muted"><kbd className="kbd">Ctrl</kbd> <kbd className="kbd">Enter</kbd> logs the ticket</span>
      <Button onClick={onClose}>Cancel</Button>
      <Button loading={busy && another.current} disabled={busy} onClick={() => { another.current = true; void submit(); }}>Log and add another</Button>
      <Button variant="primary" loading={busy && !another.current} disabled={busy} onClick={() => void submit()}>Log ticket</Button>
    </>
  );

  return (
    <Modal open={open} title={title} onClose={onClose} size="lg" footer={footer}>
      <form className="form sd-new" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        {formError && <p className="notice notice-warn" role="alert">{formError}</p>}

        {(catalogue.data?.rows.length ?? 0) > 0 && (
          <div className="sd-shortcuts" role="group" aria-label="Start from the catalogue">
            <span className="muted">Start from the catalogue:</span>
            {catalogue.data!.rows.map((c) => (
              <button key={c.id} type="button" className={`sd-pick${item?.id === c.id ? ' is-on' : ''}`} aria-pressed={item?.id === c.id}
                onClick={() => applyItem(item?.id === c.id ? null : c)}>{c.name}</button>
            ))}
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <span className="field-label" id="sd-type-label">Type</span>
            <SegmentedControl aria-labelledby="sd-type-label" size="sm" fullWidth value={v.type ?? ''} onChange={set('type')}
              data={types.map((t) => ({ value: t.value, label: t.label }))} />
            {errors.type && <span className="field-error" role="alert">{errors.type}</span>}
          </div>
          <LookupSelect label="Category" list="ticket_category" value={v.category ?? ''} onChange={set('category')} error={errors.category} />
          <TextField className="form-cell-wide" label="Title" required autoFocus value={v.title ?? ''} onChange={set('title')} error={errors.title}
            placeholder="What is wrong, or what is needed" />
          {suggest.data && (suggest.data.tickets.length > 0 || suggest.data.articles.length > 0) && (
            <aside className="form-cell-wide sd-suggest" aria-live="polite">
              {suggest.data.tickets.length > 0 && (
                <div>
                  <h3><Icon name="alert-circle" size={15} /> Possibly already logged</h3>
                  <ul>
                    {suggest.data.tickets.map((s) => (
                      <li key={s.id}>
                        <a href={`/tickets/${s.id}`} target="_blank" rel="noreferrer"><span className="ref">{s.ref}</span> {s.title}</a>
                        <LookupChip list="ticket_status" value={s.status} />
                        {s.requester_name && <span className="muted">for {s.requester_name}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {suggest.data.articles.length > 0 && (
                <div>
                  <h3><Icon name="book" size={15} /> Knowledge articles that may help</h3>
                  <ul>
                    {suggest.data.articles.map((a) => (
                      <li key={a.id}><a href={`/knowledge/${a.id}`} target="_blank" rel="noreferrer"><span className="ref">{a.ref}</span> {a.title}</a></li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="muted">Links open in a new tab, so what you have typed here is kept.</p>
            </aside>
          )}
          <TextArea className="form-cell-wide" label="Description" rows={4} value={v.description ?? ''} onChange={set('description')} error={errors.description} />
        </div>

        {questions.length > 0 && (
          <fieldset className="sd-section">
            <legend>{item?.name}: request details</legend>
            <div className="form-grid">
              {questions.map((q) => {
                const common = {
                  label: q.label, required: q.required, hint: q.hint, value: answers[q.key] ?? '', error: errors[`catalog_answers.${q.key}`],
                  onChange: (val: string) => setAnswers((old) => ({ ...old, [q.key]: val })),
                };
                if (q.type === 'longtext') return <TextArea key={q.key} className="form-cell-wide" rows={2} {...common} />;
                if (q.type === 'choice') return <Select key={q.key} options={(q.options ?? []).map((o) => ({ value: o, label: o }))} {...common} />;
                if (q.type === 'yes_no') return <Select key={q.key} options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]} {...common} />;
                if (q.type === 'date') return <DateField key={q.key} {...common} />;
                return <TextField key={q.key} {...common} />;
              })}
            </div>
            {(item?.requires_approval || (item?.tasks ?? []).length > 0) && (
              <p className="muted">
                {item?.requires_approval ? 'This request needs approval before work starts. ' : ''}
                {(item?.tasks ?? []).length > 0 ? `${item!.tasks.length} fulfilment tasks will be added to the ticket.` : ''}
              </p>
            )}
          </fieldset>
        )}

        <fieldset className="sd-section">
          <legend>Who it is for</legend>
          <div className="form-grid">
            <TextField label="Requester" value={v.requester_name ?? ''} onChange={set('requester_name')} error={errors.requester_name}
              hint="The colleague you are logging this for." />
            <TextField label="Requester department" value={v.requester_department ?? ''} onChange={set('requester_department')} error={errors.requester_department} />
            <TextField label="Requester email" type="email" value={v.requester_email ?? ''} onChange={set('requester_email')} error={errors.requester_email} />
            <TextField label="Affected person" value={v.affected_user ?? ''} onChange={set('affected_user')} error={errors.affected_user}
              hint="Only if different from the requester." />
          </div>
        </fieldset>

        <fieldset className="sd-section">
          <legend>How serious it is</legend>
          <div className="form-grid">
            <LookupSelect label="Impact" list="ticket_impact" value={v.impact ?? ''} onChange={set('impact')} error={errors.impact} />
            <LookupSelect label="Urgency" list="ticket_urgency" value={v.urgency ?? ''} onChange={set('urgency')} error={errors.urgency} />
            <div className="form-cell-wide sd-priority" aria-live="polite">
              <div className="sd-priority-main">
                <span className="muted">{override ? 'Priority set by hand' : 'Priority from impact and urgency'}</span>
                {matrix.error ? <span className="muted">could not be worked out here; the server will set it.</span>
                  : priority ? <LookupChip list="ticket_priority" value={priority} /> : <span className="muted">{override ? 'choose one below' : 'working it out…'}</span>}
              </div>
              {preview.data?.policy && priority && (
                <span className="sd-priority-due">
                  Respond by <strong>{formatDateTime(preview.data.response_due_at)}</strong> · resolve by <strong>{formatDateTime(preview.data.resolve_due_at)}</strong>
                </span>
              )}
              {preview.data && !preview.data.policy && priority && <span className="muted">No service-level target for this priority.</span>}
              <Checkbox label="Set the priority by hand" checked={override} onChange={setOverride} />
            </div>
            {override && (
              <LookupSelect className="form-cell-wide" label="Priority" list="ticket_priority" required value={v.priority ?? ''} onChange={set('priority')} error={errors.priority} />
            )}
          </div>
        </fieldset>

        <fieldset className="sd-section">
          <legend>Who works on it</legend>
          <div className="form-grid">
            <LookupSelect label="Assignment group" list="assignment_group" value={v.assignment_group ?? ''} onChange={set('assignment_group')} error={errors.assignment_group} />
            <div className="sd-assignee">
              <UserPicker label="Assignee" value={v.assignee_id ?? null} display={assigneeName} error={errors.assignee_id}
                onChange={(id, option) => { set('assignee_id')(id); setAssigneeName(option?.label); }} />
              {user && v.assignee_id !== user.id && can('tickets.edit') && (
                <Button size="sm" variant="ghost" icon="user" onClick={() => { set('assignee_id')(user.id); setAssigneeName(user.displayName); }}>Assign to me</Button>
              )}
            </div>
            {hasSystems && <RecordPicker label="Affected system" type="system" value={v.system_id ?? null} onChange={(id) => set('system_id')(id)} error={errors.system_id} />}
            {hasAssets && <RecordPicker label="Affected asset" type="asset" value={v.asset_id ?? null} onChange={(id) => set('asset_id')(id)} error={errors.asset_id} />}
            <LookupSelect label="How it arrived" list="ticket_channel" value={v.channel ?? ''} onChange={set('channel')} error={errors.channel} />
          </div>
        </fieldset>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
