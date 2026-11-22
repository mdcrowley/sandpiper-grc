// What the Tag screen does with the answers (spec §5.5 step 5): one record found from one reading
// that may act alone → its tag card; several tags in view → a list to choose from; text that needs
// the person's confirmation → offered, never opened by itself. Pure, shared by the screen and the
// tag photo harness (test/tag-photos).
import { actsAlone, type Reading } from './read';
import type { ReadingAnswer } from './lookup';

export interface CameraOutcome {
  /** Open this tag card at once. */
  open: ReadingAnswer | null;
  /** Show these answers as a list (several tags in view, a choice between records, stock, nothing found). */
  list: ReadingAnswer[];
  /** Readings the person must confirm before they are looked up. */
  confirm: Reading[];
}

export function decide(answers: ReadingAnswer[], readings: Reading[]): CameraOutcome {
  const confirm = readings.filter((r) => !actsAlone(r) && !answers.some((a) => a.reading.key === r.key));
  const one = answers.length === 1 ? answers[0] : null;
  if (one && one.status === 'record' && actsAlone(one.reading) && !confirm.length) return { open: one, list: [], confirm };
  return { open: null, list: answers, confirm };
}
