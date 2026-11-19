// The form that replaces the raw JSON of a catalog item: the values it fills in on the
// ticket, the questions it asks, the fulfillment tasks it adds, and who must approve it (E03-21:
// how many approvals, from whom, and for which answers).
import { useEffect, useState } from 'react';
import {
  api, Button, Card, Checkbox, errorMessage, IconButton, LookupSelect, NumberField, qs, Select, TextArea, TextField, UserPicker, useToast,
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
interface ApprovalDraft { requires: boolean; needed: number; approvers: string[]; question: string; answers: string[] }
interface Draft { defaults: Record<string, string>; questions: QDraft[]; tasks: string[]; approval: ApprovalDraft }

const draftOf = (row: Record<string, any>): Draft => ({
  defaults: Object.fromEntries(Object.entries((row.defaults ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])),
  questions: ((row.questions ?? []) as Question[]).map((q) => ({
    key: q.key, label: q.label, type: q.type, required: q.required, options: (q.options ?? []).join('\n'), hint: q.hint ?? '',
  })),
  tasks: [...((row.tasks ?? []) as string[])],
  approval: {
    requires: Boolean(row.requires_approval),
    needed: Number(row.approvals_needed) || 1,
    approvers: [...((row.approver_ids ?? []) as string[])],
    question: String(row.approval_condition?.question ?? ''),
    answers: [...((row.approval_condition?.answers ?? []) as string[])],
  },
});

/** Names for the chosen approvers, looked up as ids are added. */
function useNames(ids: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = ids.filter((id) => !names[id]).sort().join(',');
  useEffect(() => {
    if (!key) return;
    let live = true;
    api.get<{ id: string; label: string }[]>(`/api/users/options${qs({ ids: key })}`)
      .then((rows) => { if (live) setNames((old) => ({ ...old, ...Object.fromEntries(rows.map((r) => [r.id, r.label])) })); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [key]);
  return names;
}

/** E03-21: whether the item needs approval, how many approvals, from whom, and for which answers. */
function ApprovalCard({ d, setD, ro, errors, questions }: {
  d: ApprovalDraft; setD: (patch: Partial<ApprovalDraft>) => void; ro: boolean; errors: Record<string, string>; questions: QDraft[];
}) {
  const names = useNames(d.approvers);
  const asked = questions.filter((q) => q.key && q.label.trim());
  const q = asked.find((x) => x.key === d.question);
  const choices = q?.type === 'yes_no' ? ['Yes', 'No'] : q?.type === 'choice' ? q.options.split('\n').map((o) => o.trim()).filter(Boolean) : null;
  const toggle = (v: string, on: boolean) => setD({ answers: on ? [...d.answers, v] : d.answers.filter((a) => a !== v) });
  return (
    <Card title="Approval" actions={<span className="muted">{d.requires ? `${d.needed} approval${d.needed === 1 ? '' : 's'} needed` : 'No approval needed'}</span>}>
      <Checkbox label="Needs approval before work starts" checked={d.requires} disabled={ro} onChange={(v) => setD({ requires: v })}
        hint="While a request waits for approval it can be assigned, paused or canceled, but work cannot start." />
      {d.requires && (
        <div className="form-grid sd-approval-grid">
          <NumberField label="Approvals needed" min={1} max={5} step={1} disabled={ro} value={d.needed}
            onChange={(v) => setD({ needed: Math.min(5, Math.max(1, Math.round(Number(v) || 1))) })}
            error={errors.approvals_needed} hint="Anyone who rejects stops the request." />
          <div className="form-cell-wide sd-approvers">
            <span className="sd-approvers-label" id="sd-approvers-label">Who may approve</span>
            {d.approvers.length ? (
              <ul className="sd-chip-list" aria-labelledby="sd-approvers-label">
                {d.approvers.map((id) => (
                  <li key={id} className="sd-chip">
                    <span>{names[id] ?? 'Loading…'}</span>
                    {!ro && <IconButton icon="x" variant="ghost" size="sm" label={`Remove ${names[id] ?? 'this approver'}`} onClick={() => setD({ approvers: d.approvers.filter((x) => x !== id) })} />}
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Anyone who may approve service requests.</p>}
            {!ro && (
              <UserPicker label="Add an approver" placeholder="Type a name" value={null}
                onChange={(id) => { if (id && !d.approvers.includes(id)) setD({ approvers: [...d.approvers, id] }); }}
                error={errors.approver_ids} hint="Name people to limit approval to them. They also need the permission to approve requests." />
            )}
          </div>
          <Select className="form-cell-wide" label="Only when a question is answered" disabled={ro || !asked.length} value={d.question}
            placeholder={asked.length ? 'Always' : 'Add questions first'} options={[{ value: '', label: 'Always' }, ...asked.map((x) => ({ value: x.key!, label: x.label }))]}
            onChange={(v) => setD({ question: v ?? '', answers: [] })} error={errors.approval_condition}
            hint="For example, approval only when the answer to “Restricted system?” is Yes. A new question can be chosen once the item is saved." />
          {q && (choices ? (
            <fieldset className="form-cell-wide sd-answers">
              <legend>Answers that need approval</legend>
              {choices.map((c) => <Checkbox key={c} label={c} checked={d.answers.includes(c)} disabled={ro} onChange={(on) => toggle(c, on)} />)}
            </fieldset>
          ) : (
            <TextArea className="form-cell-wide" label="Answers that need approval" rows={2} disabled={ro} value={d.answers.join('\n')}
              onChange={(v) => setD({ answers: v.split('\n') })} hint="One on each line; capitals do not matter." />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Moves one entry of a list up or down. */
function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function CatalogDesigner({ rec }: { rec: RecordContext }) {
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
        requires_approval: d.approval.requires,
        approvals_needed: d.approval.needed,
        approver_ids: d.approval.approvers,
        approval_condition: d.approval.requires && d.approval.question
          ? { question: d.approval.question, answers: d.approval.answers.map((a) => a.trim()).filter(Boolean) } : null,
      });
      toast.success('Catalog item saved.');
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(f);
      toast.error(f.questions ?? f.tasks ?? f.approval_condition ?? f.approver_ids ?? f.approvals_needed ?? errorMessage(err));
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

      <Card title="Fulfillment tasks" actions={<span className="muted">{d.tasks.length} added to each ticket as a checklist</span>}>
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

      <ApprovalCard d={d.approval} ro={ro} errors={errors} questions={d.questions}
        setD={(patch) => setD((old) => ({ ...old, approval: { ...old.approval, ...patch } }))} />

      {canEdit && (
        <div className="form-actions sd-sticky-actions">
          <Button disabled={!dirty || busy} onClick={() => { setD(draftOf(row)); setErrors({}); }}>Undo changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={submit}>Save form, tasks and approval</Button>
        </div>
      )}
    </div>
  );
}
