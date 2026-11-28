// Checklist answers: the yes / no / not applicable buttons shared by the audit checklist and the
// inspection run screen; the audit's checklist is its workpapers (Workpapers.tsx).
import { Badge } from '../../core';

export interface ChecklistItem {
  id: string; section: string | null; prompt: string; guidance: string | null; sort: number;
  critical: boolean; photo_required: boolean; removed: boolean;
  /** Workpaper reference (E45-63): A.1 by section, and with the audit's reference. */
  wp_ref?: string | null; wp_ref_full?: string | null;
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
