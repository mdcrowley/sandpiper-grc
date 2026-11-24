// Retention periods of a record series (E41-15): when a batch of records may be destroyed, and the
// period in words. Plain functions, so they are tested without the database.
import { addDays, addMonths, isYmd } from '../../../../shared/dates.ts';
import type { Row } from '../../core/module.ts';

const TRIGGER_WORDS: Record<string, string> = {
  created: 'after they are created or received',
  closed: 'after the file or case is closed',
  fiscal_year_end: 'after the end of the fiscal year',
  calendar_year_end: 'after the end of the calendar year',
  superseded: 'after they are superseded',
  contract_end: 'after the contract or grant ends',
  separation: 'after the employee leaves',
  asset_disposed: 'after the asset or vehicle is disposed of',
  event: 'after the event',
};

/**
 * The first day the records may be destroyed: the trigger date plus the series' period. Null when
 * there is no trigger date, or the series is kept permanently or has no period.
 */
export function eligibleOn(triggerDate: string | null | undefined, series: Row): string | null {
  if (!triggerDate || !isYmd(triggerDate) || series.permanent) return null;
  const v = Number(series.retention_value);
  if (!Number.isFinite(v) || v <= 0) return null;
  switch (series.retention_unit) {
    case 'days': return addDays(triggerDate, Math.round(v));
    case 'months': return addMonths(triggerDate, Math.round(v));
    default: return addMonths(triggerDate, Math.round(v * 12)); // years, half years allowed
  }
}

/** "7 years after the file or case is closed", or "Kept permanently". */
export function periodText(series: Row): string {
  if (series.permanent) return 'Kept permanently';
  const v = Number(series.retention_value);
  if (!Number.isFinite(v) || v <= 0) return 'No period set';
  const unit = String(series.retention_unit ?? 'years');
  const word = v === 1 ? unit.replace(/s$/, '') : unit;
  const after = TRIGGER_WORDS[String(series.trigger_event)] ?? 'after the trigger event';
  return `${v} ${word} ${after}${series.trigger_event === 'event' && series.trigger_note ? ` (${series.trigger_note})` : ''}`;
}
