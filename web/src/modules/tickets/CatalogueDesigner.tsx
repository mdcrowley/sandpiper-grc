// The form that replaces the raw JSON of a catalogue item: the values it fills in on the
// ticket, the questions it asks, and the fulfilment tasks it adds.
import { useEffect, useState } from 'react';
import {
  Button, Card, Checkbox, errorMessage, IconButton, LookupSelect, Select, TextArea, TextField, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { fieldErrors, type Question } from './util';

const TYPES: { value: Question['type']; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'choice', label: 'One of a list' },
  { value: 'date', label: 'Date' },
  { value: 'yes_no', label: 'Yes or no' },
];

interface QDraft { key?: string; label: string; type: Question['type']; required: boolean; options: string; hint: string }
interface Draft { defaults: Record<string, string>; questions: QDraft[]; tasks: string[] }

const draftOf = (row: Record<string, any>): Draft => ({
  defaults: Object.fromEntries(Object.entries((row.defaults ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])),
  questions: ((row.questions ?? []) as Question[]).map((q) => ({
    key: q.key, label: q.label, type: q.type, required: q.required, options: (q.options ?? []).join('\n'), hint: q.hint ?? '',
  })),
  tasks: [...((row.tasks ?? []) as string[])],
});

/** Moves one entry of a list up or down. */
function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function CatalogueDesigner({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => draftOf(row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD(draftOf(row)); setErrors({}); }, [row]);

  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(row));
  const setDefault = (key: string) => (value: string) => setD((old) => ({ ...old, defaults: { ...old.defaults, [key]: value } }));
  const setQ = (i: number, patch: Partial<QDraft>) => setD((old) => ({ ...old, questions: old.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) }));
  const setTask = (i: number, value: string) => setD((old) => ({ ...old, tasks: old.tasks.map((t, n) => (n === i ? value : t)) }));

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await save({
        defaults: Object.fromEntries(Object.entries(d.defaults).filter(([, v]) => v !== '')),
        questions: d.questions.map((q) => ({
          key: q.key, label: q.label.trim(), type: q.type, required: q.required, hint: q.hint.trim(),
          ...(q.type === 'choice' ? { options: q.options.split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
        })),
        tasks: d.tasks.map((t) => t.trim()).filter(Boolean),
      });
      toast.success('Catalogue item saved.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(fieldErrors(err).questions ?? fieldErrors(err).tasks ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ro = !canEdit;
  return (
    <div className="stack">
      <Card title="What it fills in on the ticket">
        <p className="muted">Choosing this item starts a ticket with these values. The agent can change any of them before logging it.</p>
        <div className="form-grid">
          <LookupSelect label="Type" list="ticket_type" disabled={ro} value={d.defaults.type ?? ''} onChange={setDefault('type')} />
          <LookupSelect label="Category" list="ticket_category" disabled={ro} value={d.defaults.category ?? ''} onChange={setDefault('category')} />
          <TextField className="form-cell-wide" label="Title starts with" disabled={ro} value={d.defaults.title ?? ''} onChange={setDefault('title')} placeholder="For example Access request: " />
          <TextArea className="form-cell-wide" label="Description template" rows={3} disabled={ro} value={d.defaults.description ?? ''} onChange={setDefault('description')}
            hint="Prompts for anything the questions below do not cover." />
          <LookupSelect label="Impact" list="ticket_impact" disabled={ro} value={d.defaults.impact ?? ''} onChange={setDefault('impact')} />
          <LookupSelect label="Urgency" list="ticket_urgency" disabled={ro} value={d.defaults.urgency ?? ''} onChange={setDefault('urgency')} />
          <LookupSelect label="Assignment group" list="assignment_group" disabled={ro} value={d.defaults.assignment_group ?? ''} onChange={setDefault('assignment_group')} />
          <LookupSelect label="How it arrived" list="ticket_channel" disabled={ro} value={d.defaults.channel ?? ''} onChange={setDefault('channel')} />
        </div>
      </Card>

      <Card title="Questions" actions={<span className="muted">{d.questions.length} asked when the ticket is logged</span>}>
        {errors.questions && <p className="notice notice-warn" role="alert">{errors.questions}</p>}
        {d.questions.length === 0 && <p className="muted">No questions. The answers to questions are kept on the ticket under Request details.</p>}
        <ol className="sd-builder">
          {d.questions.map((q, i) => (
            <li key={i}>
              <div className="sd-builder-fields">
                <TextField label={`Question ${i + 1}`} required disabled={ro} value={q.label} onChange={(v) => setQ(i, { label: v })} placeholder="For example Start date" />
                <Select label="Answer" required disabled={ro} value={q.type} options={TYPES} onChange={(v) => setQ(i, { type: (v || 'text') as Question['type'] })} />
                {q.type === 'choice' && (
                  <TextArea className="sd-builder-wide" label="Choices" required rows={2} disabled={ro} value={q.options} onChange={(v) => setQ(i, { options: v })} hint="One on each line; at least two." />
                )}
                <TextField className="sd-builder-wide" label="Help text (optional)" disabled={ro} value={q.hint} onChange={(v) => setQ(i, { hint: v })} />
                <Checkbox label="An answer is required" checked={q.required} disabled={ro} onChange={(v) => setQ(i, { required: v })} />
              </div>
              {canEdit && (
                <div className="sd-builder-tools">
                  <IconButton icon="arrow-up" variant="ghost" size="sm" label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => setD((old) => ({ ...old, questions: move(old.questions, i, -1) }))} />
                  <IconButton icon="arrow-down" variant="ghost" size="sm" label={`Move question ${i + 1} down`} disabled={i === d.questions.length - 1} onClick={() => setD((old) => ({ ...old, questions: move(old.questions, i, 1) }))} />
                  <IconButton icon="trash" variant="ghost" size="sm" label={`Remove question ${i + 1}`} onClick={() => setD((old) => ({ ...old, questions: old.questions.filter((_, n) => n !== i) }))} />
                </div>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <div><Button icon="plus" onClick={() => setD((old) => ({ ...old, questions: [...old.questions, { label: '', type: 'text', required: false, options: '', hint: '' }] }))}>Add question</Button></div>
        )}
      </Card>

      <Card title="Fulfilment tasks" actions={<span className="muted">{d.tasks.length} added to each ticket as a checklist</span>}>
        {errors.tasks && <p className="notice notice-warn" role="alert">{errors.tasks}</p>}
        {d.tasks.length === 0 && <p className="muted">No tasks. Tasks appear on the ticket as a checklist the agent ticks off.</p>}
        <ol className="sd-builder sd-builder-tasks">
          {d.tasks.map((t, i) => (
            <li key={i}>
              <TextField label={`Task ${i + 1}`} hideLabel disabled={ro} value={t} onChange={(v) => setTask(i, v)} placeholder="For example Create the account" />
              {canEdit && (
                <div className="sd-builder-tools">
                  <IconButton icon="arrow-up" variant="ghost" size="sm" label={`Move task ${i + 1} up`} disabled={i === 0} onClick={() => setD((old) => ({ ...old, tasks: move(old.tasks, i, -1) }))} />
                  <IconButton icon="arrow-down" variant="ghost" size="sm" label={`Move task ${i + 1} down`} disabled={i === d.tasks.length - 1} onClick={() => setD((old) => ({ ...old, tasks: move(old.tasks, i, 1) }))} />
                  <IconButton icon="trash" variant="ghost" size="sm" label={`Remove task ${i + 1}`} onClick={() => setD((old) => ({ ...old, tasks: old.tasks.filter((_, n) => n !== i) }))} />
                </div>
              )}
            </li>
          ))}
        </ol>
        {canEdit && <div><Button icon="plus" onClick={() => setD((old) => ({ ...old, tasks: [...old.tasks, ''] }))}>Add task</Button></div>}
      </Card>

      {canEdit && (
        <div className="form-actions sd-sticky-actions">
          <Button disabled={!dirty || busy} onClick={() => { setD(draftOf(row)); setErrors({}); }}>Undo changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={submit}>Save form and tasks</Button>
        </div>
      )}
    </div>
  );
}
