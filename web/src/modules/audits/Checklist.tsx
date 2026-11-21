// Checklist answers: the yes / no / not applicable buttons shared by the audit checklist and the
// inspection run screen, and the audit's checklist tab.
import { useState } from 'react';
import {
  api, Badge, Card, EmptyState, errorMessage, ErrorState, formatDateTime, Loading, ProgressBar, TextArea, useFetch, useToast,
} from '../../core';

export interface ChecklistItem {
  id: string; section: string | null; prompt: string; guidance: string | null; sort: number;
  critical: boolean; photo_required: boolean; removed: boolean;
}
export interface ChecklistResponse {
  item_id: string; answer: 'yes' | 'no' | 'na' | null; note: string | null; attachment_ids: string[];
  answered_by_name: string | null; answered_at: string | null;
}
export interface ChecklistData {
  template: { id: string; name: string; kind: string; version: number; active: boolean } | null;
  items: ChecklistItem[];
  responses: Record<string, ChecklistResponse>;
  answered: number;
  total: number;
  can_answer: boolean;
}

export const ANSWER_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', na: 'Not applicable' };
const ANSWER_COLOR: Record<string, 'green' | 'red' | 'gray'> = { yes: 'green', no: 'red', na: 'gray' };

/** Three large buttons; the chosen one is pressed. */
export function AnswerButtons({ value, onAnswer, disabled, label, large }: {
  value: string | null | undefined; onAnswer: (answer: 'yes' | 'no' | 'na') => void; disabled?: boolean; label: string; large?: boolean;
}) {
  return (
    <div className={`au-answers${large ? ' is-large' : ''}`} role="group" aria-label={label}>
      {(['yes', 'no', 'na'] as const).map((a) => (
        <button key={a} type="button" className={`au-answer au-answer-${a}${value === a ? ' is-chosen' : ''}`}
          aria-pressed={value === a} disabled={disabled} onClick={() => onAnswer(a)}>
          {a === 'na' && !large ? 'N/A' : ANSWER_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

export function ItemFlags({ item }: { item: ChecklistItem }) {
  if (!item.critical && !item.photo_required && !item.removed) return null;
  return (
    <span className="au-flags">
      {item.critical && <Badge color="red">Critical</Badge>}
      {item.photo_required && <Badge color="blue">Photo needed</Badge>}
      {item.removed && <Badge color="gray">No longer on the checklist</Badge>}
    </span>
  );
}

/** Groups items under their section headings, keeping the checklist's order. */
export function bySection(items: ChecklistItem[]): { section: string | null; items: ChecklistItem[] }[] {
  const out: { section: string | null; items: ChecklistItem[] }[] = [];
  for (const i of items) {
    const last = out.at(-1);
    if (last && last.section === i.section) last.items.push(i);
    else out.push({ section: i.section, items: [i] });
  }
  return out;
}

function NoteEditor({ initial, onSave, disabled, label }: { initial: string; onSave: (note: string) => Promise<void>; disabled: boolean; label: string }) {
  const [note, setNote] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = note !== initial;
  return (
    <div className="au-note">
      <TextArea label={label} value={note} onChange={setNote} rows={1} disabled={disabled} />
      {dirty && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
          onClick={async () => { setBusy(true); try { await onSave(note); } finally { setBusy(false); } }}>Save note</button>
      )}
    </div>
  );
}

/** The audit's checklist, answered in place (Checklist tab of an audit). */
export function AuditChecklist({ auditId, closed }: { auditId: string; closed: boolean }) {
  const toast = useToast();
  const url = `/api/audits/${auditId}/checklist`;
  const { data, error, reload } = useFetch<ChecklistData>(url);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} />;
  if (!data.template) {
    return <EmptyState icon="check-square" title="No checklist chosen" message="Choose an audit checklist in the audit's details (Checklist field) to work through it here." />;
  }
  const canAnswer = data.can_answer && !closed;
  const save = async (itemId: string, body: Record<string, unknown>) => {
    setBusy(itemId);
    try { await api.put(url, { item_id: itemId, ...body }); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(null); }
  };
  return (
    <div className="stack">
      <Card title={data.template.name} actions={<span className="muted">Version {data.template.version}</span>}>
        <ProgressBar label="Items answered" value={data.answered} max={Math.max(1, data.total)} valueText={`${data.answered} of ${data.total}`} color="blue" />
      </Card>
      {bySection(data.items).map((g) => (
        <Card key={`${g.section}-${g.items[0].id}`} title={g.section ?? 'Checklist'} flush>
          <ol className="au-list">
            {g.items.map((i) => {
              const r = data.responses[i.id];
              return (
                <li key={i.id} className="au-list-item">
                  <div className="au-list-main">
                    <p className="au-prompt">{i.prompt} <ItemFlags item={i} /></p>
                    {i.guidance && <p className="muted au-guidance">{i.guidance}</p>}
                    {r?.answered_by_name && <p className="muted au-meta">{ANSWER_LABEL[r.answer ?? ''] ?? 'Cleared'} · {r.answered_by_name}, {formatDateTime(r.answered_at)}</p>}
                    {(canAnswer || r?.note) && (
                      <NoteEditor key={r?.note ?? ''} initial={r?.note ?? ''} label="Note" disabled={!canAnswer || busy === i.id}
                        onSave={(note) => save(i.id, { answer: r?.answer ?? null, note })} />
                    )}
                  </div>
                  {canAnswer
                    ? <AnswerButtons value={r?.answer} label={`Answer: ${i.prompt}`} disabled={busy === i.id} onAnswer={(a) => save(i.id, { answer: a })} />
                    : r?.answer ? <Badge color={ANSWER_COLOR[r.answer]}>{ANSWER_LABEL[r.answer]}</Badge> : <span className="muted">Not answered</span>}
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </div>
  );
}
