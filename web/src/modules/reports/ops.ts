// The comparisons a report filter offers for each kind of field, in plain words. Kept apart from
// the controls (FilterEditor.tsx) so that plain functions, such as the sentence describing a report, can use them.
import type { FieldType } from '../../core';
import type { CatalogField, Condition } from './types';

export type Input = 'none' | 'text' | 'number' | 'numbers' | 'date' | 'dates' | 'days' | 'options' | 'user' | 'record';
export interface Op { op: string; label: string; input: Input }

const EMPTY: Op[] = [{ op: 'empty', label: 'is empty', input: 'none' }, { op: 'nempty', label: 'is not empty', input: 'none' }];
const OPS: Record<string, Op[]> = {
  text: [
    { op: 'contains', label: 'contains', input: 'text' }, { op: 'ncontains', label: 'does not contain', input: 'text' },
    { op: 'eq', label: 'is exactly', input: 'text' }, { op: 'starts', label: 'starts with', input: 'text' }, ...EMPTY,
  ],
  number: [
    { op: 'gte', label: 'is at least', input: 'number' }, { op: 'lte', label: 'is at most', input: 'number' },
    { op: 'gt', label: 'is more than', input: 'number' }, { op: 'lt', label: 'is less than', input: 'number' },
    { op: 'eq', label: 'is exactly', input: 'number' }, { op: 'ne', label: 'is not', input: 'number' },
    { op: 'between', label: 'is between', input: 'numbers' }, ...EMPTY,
  ],
  date: [
    { op: 'last_days', label: 'in the last … days', input: 'days' }, { op: 'next_days', label: 'in the next … days', input: 'days' },
    { op: 'this_month', label: 'this month', input: 'none' }, { op: 'this_quarter', label: 'this quarter', input: 'none' }, { op: 'this_year', label: 'this year', input: 'none' },
    { op: 'past', label: 'before today', input: 'none' }, { op: 'future', label: 'after today', input: 'none' },
    { op: 'gte', label: 'on or after', input: 'date' }, { op: 'lte', label: 'on or before', input: 'date' }, { op: 'eq', label: 'on', input: 'date' },
    { op: 'between', label: 'between', input: 'dates' },
    { op: 'empty', label: 'has no date', input: 'none' }, { op: 'nempty', label: 'has a date', input: 'none' },
  ],
  boolean: [{ op: 'true', label: 'is yes', input: 'none' }, { op: 'false', label: 'is no', input: 'none' }],
  lookup: [{ op: 'in', label: 'is any of', input: 'options' }, { op: 'nin', label: 'is none of', input: 'options' }, ...EMPTY],
  user: [
    { op: 'me', label: 'is me', input: 'none' }, { op: 'in', label: 'is', input: 'user' }, { op: 'nin', label: 'is not', input: 'user' },
    { op: 'empty', label: 'is nobody', input: 'none' }, { op: 'nempty', label: 'is somebody', input: 'none' },
  ],
  ref: [{ op: 'in', label: 'is', input: 'record' }, { op: 'nin', label: 'is not', input: 'record' }, ...EMPTY],
  json: EMPTY,
};
const family = (t: FieldType) => (t === 'longtext' ? 'text' : t === 'currency' ? 'number' : t === 'datetime' ? 'date' : t);
/** A multi-choice field holds several values: it has any of them, or none of them. */
const MULTI: Op[] = [
  { op: 'in', label: 'has any of', input: 'options' }, { op: 'nin', label: 'has none of', input: 'options' },
  { op: 'empty', label: 'has no value', input: 'none' }, { op: 'nempty', label: 'has a value', input: 'none' },
];
export const opsFor = (t: FieldType, multiple?: boolean): Op[] => (multiple ? MULTI : OPS[family(t)] ?? EMPTY);

/** A sensible first condition for a field, so a new row already says something. */
export function defaultCondition(f: CatalogField): Condition {
  const first = opsFor(f.type, f.multiple)[0];
  return { field: f.path, op: first.op, value: first.input === 'days' ? 30 : first.input === 'options' ? [] : undefined };
}

