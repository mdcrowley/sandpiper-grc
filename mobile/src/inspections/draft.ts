// An inspection run on the phone (wave 15, E38-11): the answers given so far are a draft kept on the
// phone (offline/sqlite.ts drafts), merged with the answers already on the server (the offline package),
// checked with the same rules the server applies (shared/inspection-rules.ts), and finally saved in the
// outbox as one group: each photo and the drawn signature (`attachment` items to the inspection), then
// the answers and completion (`inspection.complete`) naming those photos by their ids. Pure.
import {
  completionProblem, liveItems, scoreChecklist, type AnswerOf, type CompletionProblem,
} from '../../../shared/inspection-rules.ts';
import type { PackageChecklistItem, PackageInspection, SyncInspectionWork } from '../../../shared/mobile-api.ts';
import type { NewOutboxItem } from '../offline/outbox';

export type Answer = 'yes' | 'no' | 'na';

export interface DraftPhoto { uri: string; name: string }

export interface DraftAnswer {
  answer: Answer | null;
  /** Undefined: the note on the server is kept. */
  note?: string;
  /** Photos taken on the phone for this item (kept in the draft's protected folder). */
  photos: DraftPhoto[];
  /** Photos of this item already handed to the outbox (with the answers so far). */
  sentPhotos?: number;
}

export interface InspectionDraft {
  inspectionId: string;
  answers: Record<string, DraftAnswer>;
  /** The note for the whole inspection, given when completing. */
  notes?: string;
  updatedAt: string;
  /** When the answers so far were last handed to the outbox. */
  sentAt?: string;
}

export const draftKey = (inspectionId: string) => `inspection:${inspectionId}`;

export const emptyDraft = (inspectionId: string, now = new Date()): InspectionDraft => ({ inspectionId, answers: {}, updatedAt: now.toISOString() });

/** What an item's answer is now: the phone's, or else the server's. */
export function currentAnswer(ins: PackageInspection, draft: InspectionDraft | null, itemId: string): { answer: Answer | null; note: string; photos: number; phonePhotos: number } {
  const server = ins.checklist?.responses[itemId];
  const mine = draft?.answers[itemId];
  const phonePhotos = mine?.photos.length ?? 0;
  return {
    answer: (mine ? mine.answer : server?.answer) ?? null,
    note: mine?.note ?? server?.note ?? '',
    photos: (server?.photos ?? 0) + phonePhotos + (mine?.sentPhotos ?? 0),
    phonePhotos,
  };
}

export const answerOfDraft = (ins: PackageInspection, draft: InspectionDraft | null): AnswerOf => (id) => {
  const a = currentAnswer(ins, draft, id);
  return { answer: a.answer, photos: a.photos };
};

/** The items to answer, in order: those still on the checklist, and removed ones already answered. */
export function runItems(ins: PackageInspection, draft: InspectionDraft | null): PackageChecklistItem[] {
  return liveItems(ins.checklist?.items ?? [], answerOfDraft(ins, draft));
}

/** What completing would give now, as the server works it out; `problem` says what is still needed. */
export function preview(ins: PackageInspection, draft: InspectionDraft | null): { problem: CompletionProblem | null; result: string; scorePct: number | null; failed: PackageChecklistItem[] } {
  const items = ins.checklist?.items ?? [];
  const answerOf = answerOfDraft(ins, draft);
  const problem = completionProblem(items, answerOf);
  const { result, score_pct, failed } = scoreChecklist(liveItems(items, answerOf), answerOf);
  return { problem, result, scorePct: score_pct, failed };
}

/** Changes one item's answer in the draft (a new draft; the old one is untouched). */
export function withAnswer(draft: InspectionDraft, itemId: string, change: Partial<DraftAnswer>, now = new Date()): InspectionDraft {
  const prev = draft.answers[itemId] ?? { answer: null, photos: [] };
  const next: DraftAnswer = { ...prev, ...change, photos: change.photos ?? prev.photos };
  return { ...draft, answers: { ...draft.answers, [itemId]: next }, updatedAt: now.toISOString() };
}

/** The draft's answers as the server takes them: only items answered or changed on the phone. */
function answersToSend(ins: PackageInspection, draft: InspectionDraft): { itemId: string; a: DraftAnswer }[] {
  return Object.entries(draft.answers)
    .filter(([itemId, a]) => (ins.checklist?.items ?? []).some((i) => i.id === itemId) && (a.answer !== null || a.note !== undefined || a.photos.length))
    .map(([itemId, a]) => ({ itemId, a }));
}

export interface SaveOptions {
  /** Complete the inspection (otherwise only the answers are saved). */
  complete: boolean;
  raiseFindings?: boolean;
  notes?: string;
  /** The signature of completion: the signer's name, and the drawn signature as a PNG file (optional). */
  signature?: { name: string; file: DraftPhoto | null } | null;
  newId(): string;
  now?: Date;
}

/**
 * The outbox items of one inspection: its photos and signature first (attached to the inspection),
 * then the answers (and completion), which name the photos by their ids. Saved together, in one call.
 */
export function inspectionItems(ins: PackageInspection, draft: InspectionDraft, opts: SaveOptions): NewOutboxItem[] {
  const out: NewOutboxItem[] = [];
  const prompt = (id: string) => ins.checklist?.items.find((i) => i.id === id)?.prompt ?? '';
  const answers: SyncInspectionWork['answers'] = [];
  let n = 0;
  for (const { itemId, a } of answersToSend(ins, draft)) {
    const photos: string[] = [];
    for (const p of a.photos) {
      const id = opts.newId();
      n += 1;
      photos.push(id);
      out.push({
        id, kind: 'attachment', label: `Photo ${n}`, file: { uri: p.uri, name: p.name },
        payload: { recordType: 'inspection', recordId: ins.id, name: p.name, description: `Photo: ${prompt(itemId)}`.slice(0, 200) },
      });
    }
    answers.push({ itemId, answer: a.answer, ...(a.note !== undefined ? { note: a.note } : {}), ...(photos.length ? { photos } : {}) });
  }
  const work: SyncInspectionWork = { inspectionId: ins.id, answers };
  if (opts.complete) {
    work.raiseFindings = opts.raiseFindings !== false;
    if (opts.notes?.trim()) work.notes = opts.notes.trim();
    if (opts.signature?.name.trim()) {
      let photo: string | null = null;
      if (opts.signature.file) {
        photo = opts.newId();
        out.push({
          id: photo, kind: 'attachment', label: 'Signature', file: { uri: opts.signature.file.uri, name: opts.signature.file.name },
          payload: { recordType: 'inspection', recordId: ins.id, name: opts.signature.file.name, description: `Signature of completion: ${opts.signature.name.trim()}`.slice(0, 200) },
        });
      }
      work.signature = { name: opts.signature.name.trim(), photo };
    }
  }
  out.push({
    id: opts.newId(), kind: opts.complete ? 'inspection.complete' : 'inspection.answers',
    label: [ins.ref, ins.title].filter(Boolean).join(' '), payload: work as unknown as Record<string, unknown>,
  });
  return out;
}

/** The draft once its answers were handed to the outbox: the answers stay (the package may be older), the photos went. */
export function afterSent(draft: InspectionDraft, now = new Date()): InspectionDraft {
  const answers: Record<string, DraftAnswer> = {};
  for (const [k, a] of Object.entries(draft.answers)) answers[k] = { ...a, photos: [], sentPhotos: (a.sentPhotos ?? 0) + a.photos.length };
  return { ...draft, answers, updatedAt: now.toISOString(), sentAt: now.toISOString() };
}

/** Whether the draft has answers not yet handed to the outbox. */
export const hasUnsent = (draft: InspectionDraft | null) =>
  Boolean(draft && Object.keys(draft.answers).length && (!draft.sentAt || draft.updatedAt > draft.sentAt));

/** Words for the result. */
export const RESULT_TEXT: Record<string, string> = { pass: 'Pass', pass_with_findings: 'Pass with findings', fail: 'Fail' };

/** A file name for the drawn signature: signature-20261122-142501.png. */
export function signatureName(at: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `signature-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.png`;
}
