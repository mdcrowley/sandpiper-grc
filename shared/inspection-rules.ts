// The rules of running an inspection's checklist (E24-06, E38-11), one copy for the server's
// `POST /api/inspections/:id/complete` (server/src/modules/audits/checklists.ts) and the mobile app's
// runner (mobile/src/inspections), so the app shows exactly what the server will decide:
//
// - Every item still on the checklist must be answered (yes, no or not applicable). An item removed
//   from the template after it was answered keeps its answer and counts; one removed before is left out.
// - An item that needs a photo must have at least one, unless it is not applicable.
// - Result: Fail when a critical item is not met; Pass with findings when another item is not met;
//   otherwise Pass. Score: items met out of items answered yes or no (one decimal), none when no item
//   was answered yes or no.
// - Each item not met becomes a finding (major nonconformity when critical, minor otherwise), unless
//   the inspector chooses otherwise.
//
// Pure, no imports: the server, the web and the app use it as it is.

export const CHECKLIST_ANSWERS = ['yes', 'no', 'na'] as const;
export type ChecklistAnswer = (typeof CHECKLIST_ANSWERS)[number];

/** What the rules need of an item. */
export interface RuleItem { id: string; prompt: string; critical: boolean; photo_required: boolean; removed?: boolean }

/** What the rules need of an answer: the answer, and how many photos it has. */
export interface RuleAnswer { answer: string | null | undefined; photos: number }

export type AnswerOf = (itemId: string) => RuleAnswer | undefined;

/** The items that count: those still on the checklist, and removed ones that were answered. */
export function liveItems<T extends RuleItem>(items: T[], answerOf: AnswerOf): T[] {
  return items.filter((i) => !i.removed || Boolean(answerOf(i.id)?.answer));
}

/** Result and score from the answers: any critical item not met fails; any other item not met gives findings. */
export function scoreChecklist<T extends RuleItem>(items: T[], answerOf: AnswerOf): { result: 'pass' | 'pass_with_findings' | 'fail'; score_pct: number | null; failed: T[] } {
  let yes = 0;
  let no = 0;
  const failed: T[] = [];
  for (const i of items) {
    const a = answerOf(i.id)?.answer;
    if (a === 'yes') yes += 1;
    if (a === 'no') { no += 1; failed.push(i); }
  }
  const score_pct = yes + no ? Math.round((yes / (yes + no)) * 1000) / 10 : null;
  const result = failed.some((i) => i.critical) ? 'fail' : failed.length ? 'pass_with_findings' : 'pass';
  return { result, score_pct, failed };
}

/** Why the checklist cannot be completed yet, in the server's words; null when it can. */
export interface CompletionProblem { code: 'incomplete' | 'photo_required'; message: string; fields?: Record<string, string>; items: string[] }

export function completionProblem<T extends RuleItem>(items: T[], answerOf: AnswerOf): CompletionProblem | null {
  const live = liveItems(items, answerOf);
  const missing = live.filter((i) => !answerOf(i.id)?.answer);
  if (missing.length) {
    return {
      code: 'incomplete', message: `Answer every item first: ${missing.length} still open.`,
      fields: { items: missing.map((i) => i.prompt).slice(0, 5).join('; ') }, items: missing.map((i) => i.id),
    };
  }
  const noPhoto = live.filter((i) => i.photo_required && answerOf(i.id)?.answer !== 'na' && !(answerOf(i.id)?.photos ?? 0));
  if (noPhoto.length) {
    return {
      code: 'photo_required', message: `Add a photo to every item that needs one: ${noPhoto.map((i) => i.prompt).slice(0, 3).join('; ')}.`,
      items: noPhoto.map((i) => i.id),
    };
  }
  return null;
}

/** The rating of the finding an item not met raises. */
export const findingRatingOf = (item: Pick<RuleItem, 'critical'>) => (item.critical ? 'major_nonconformity' : 'minor_nonconformity');

/** Longest name accepted as the signature of completion. */
export const SIGNATURE_NAME_MAX = 200;
