// Friendly filter rows: pick a field, a comparison in plain words, and a value with the right
// control for the field's type. Rows sit in a group that matches "all" or "any"; a group can hold
// one more level of groups, which is enough for "A and (B or C)".
import { Button, DateField, IconButton, MultiSelect, NumberField, RecordPicker, Select, TextField, UserPicker, useLookup } from '../../core';
import type { FieldType } from '../../core';
import { isGroup, type CatalogField, type Condition, type FilterGroup } from './types';

type Input = 'none' | 'text' | 'number' | 'numbers' | 'date' | 'dates' | 'days' | 'options' | 'user' | 'record';
interface Op { op: string; label: string; input: Input }

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
export const opsFor = (t: FieldType): Op[] => OPS[family(t)] ?? EMPTY;

/** A sensible first condition for a field, so a new row already says something. */
export function defaultCondition(f: CatalogField): Condition {
  const first = opsFor(f.type)[0];
  return { field: f.path, op: first.op, value: first.input === 'days' ? 30 : first.input === 'options' ? [] : undefined };
}

type Labeled = Condition & { label?: string };

function ValueControl({ field, cond, input, onChange }: { field: CatalogField; cond: Labeled; input: Input; onChange: (c: Labeled) => void }) {
  const options = useLookup(field.list ?? '');
  const set = (value: unknown, label?: string) => onChange({ ...cond, value, label });
  const pair = (Array.isArray(cond.value) ? cond.value : [undefined, undefined]) as [unknown, unknown];
  const one = Array.isArray(cond.value) ? (cond.value[0] as string | undefined) : (cond.value as string | undefined);
  switch (input) {
    case 'text': return <TextField label="Text" hideLabel value={String(cond.value ?? '')} onChange={(v) => set(v)} placeholder="Type some text" />;
    case 'number': return <NumberField label="Number" hideLabel value={typeof cond.value === 'number' ? cond.value : null} onChange={(v) => set(v ?? undefined)} placeholder="A number" />;
    case 'days': return <NumberField label="Days" hideLabel min={1} max={3650} value={typeof cond.value === 'number' ? cond.value : null} onChange={(v) => set(v ?? undefined)} placeholder="Days" />;
    case 'date': return <DateField label="Date" hideLabel value={typeof cond.value === 'string' ? cond.value : ''} onChange={(v) => set(v || undefined)} />;
    case 'numbers': return (
      <div className="rp-pair">
        <NumberField label="From" hideLabel value={typeof pair[0] === 'number' ? pair[0] : null} onChange={(v) => set([v ?? undefined, pair[1]])} placeholder="From" />
        <NumberField label="To" hideLabel value={typeof pair[1] === 'number' ? pair[1] : null} onChange={(v) => set([pair[0], v ?? undefined])} placeholder="To" />
      </div>
    );
    case 'dates': return (
      <div className="rp-pair">
        <DateField label="From" hideLabel value={typeof pair[0] === 'string' ? pair[0] : ''} onChange={(v) => set([v || undefined, pair[1]])} placeholder="From" />
        <DateField label="To" hideLabel value={typeof pair[1] === 'string' ? pair[1] : ''} onChange={(v) => set([pair[0], v || undefined])} placeholder="To" />
      </div>
    );
    case 'options': return (
      <MultiSelect label={Array.isArray(cond.value) && cond.value.length ? `${cond.value.length} chosen` : 'Choose values'} options={options.map((o) => ({ value: o.value, label: o.label, color: o.color }))}
        value={Array.isArray(cond.value) ? (cond.value as string[]) : []} onChange={(v) => set(v)} />
    );
    case 'user': return <UserPicker label="Person" hideLabel value={one ?? null} display={cond.label} onChange={(id, opt) => set(id ? [id] : [], opt?.label)} placeholder="Find a person" />;
    case 'record': return <RecordPicker label="Record" hideLabel type={field.to!} value={one ?? null} display={cond.label} onChange={(id, opt) => set(id ? [id] : [], opt?.label)} placeholder="Find a record" />;
    default: return null;
  }
}

function Row({ fields, cond, onChange, onRemove }: { fields: CatalogField[]; cond: Labeled; onChange: (c: Labeled) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.path === cond.field);
  const ops = field ? opsFor(field.type) : [];
  const op = ops.find((o) => o.op === cond.op) ?? ops[0];
  return (
    <div className="rp-cond">
      <Select label="Field" hideLabel required searchable value={cond.field} options={fields.map((f) => ({ value: f.path, label: f.label }))}
        onChange={(path) => { const f = fields.find((x) => x.path === path); if (f) onChange(defaultCondition(f)); }} />
      <Select label="Comparison" hideLabel required value={op?.op ?? ''} options={ops.map((o) => ({ value: o.op, label: o.label }))}
        onChange={(next) => {
          const to = ops.find((o) => o.op === next);
          // Keep the value when the new comparison takes the same kind of value.
          onChange({ field: cond.field, op: next, value: to && op && to.input === op.input ? cond.value : to?.input === 'days' ? 30 : to?.input === 'options' ? [] : undefined, label: to && op && to.input === op.input ? cond.label : undefined });
        }} />
      <div className="rp-cond-value">{field && op && <ValueControl field={field} cond={cond} input={op.input} onChange={onChange} />}</div>
      <IconButton icon="x" label="Remove this condition" variant="ghost" size="sm" onClick={onRemove} />
    </div>
  );
}

export interface FilterEditorProps {
  fields: CatalogField[];
  value: FilterGroup | undefined;
  onChange: (next: FilterGroup | undefined) => void;
  /** Inner groups may not hold groups of their own. */
  nested?: boolean;
}

export function FilterEditor({ fields, value, onChange, nested }: FilterEditorProps) {
  const group: FilterGroup = value ?? { op: 'and', items: [] };
  const usable = fields.filter((f) => f.type !== 'json');
  const update = (items: FilterGroup['items'], op = group.op) => onChange(items.length || nested ? { op, items } : undefined);
  const replace = (i: number, item: Condition | FilterGroup | undefined) => update(group.items.flatMap((x, j) => (j === i ? (item ? [item] : []) : [x])));
  const first = usable[0];
  return (
    <div className={nested ? 'rp-filter rp-filter-nested' : 'rp-filter'}>
      {group.items.length > 1 && (
        <div className="rp-filter-match">
          <span>Show records that match</span>
          <Select label="Match" hideLabel required value={group.op} options={[{ value: 'and', label: 'all of these' }, { value: 'or', label: 'any of these' }]} onChange={(op) => update(group.items, op as 'and' | 'or')} />
        </div>
      )}
      {group.items.map((item, i) => (
        <div key={i} className="rp-filter-item">
          {i > 0 && <span className="rp-filter-joiner">{group.op === 'and' ? 'and' : 'or'}</span>}
          {isGroup(item)
            ? (
              <div className="rp-filter-group">
                <FilterEditor nested fields={fields} value={item} onChange={(g) => replace(i, g && g.items.length ? g : undefined)} />
              </div>
            )
            : <Row fields={usable} cond={item} onChange={(c) => replace(i, c)} onRemove={() => replace(i, undefined)} />}
        </div>
      ))}
      <div className="rp-filter-add">
        <Button size="sm" variant="ghost" icon="plus" disabled={!first} onClick={() => first && update([...group.items, defaultCondition(usable.find((f) => f.path === 'status') ?? first)])}>
          {group.items.length ? 'Add another condition' : 'Add a condition'}
        </Button>
        {!nested && group.items.length > 0 && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => first && update([...group.items, { op: group.op === 'and' ? 'or' : 'and', items: [defaultCondition(first), defaultCondition(first)] }])}>
            Add a group ({group.op === 'and' ? 'any of' : 'all of'} …)
          </Button>
        )}
      </div>
    </div>
  );
}

/** Conditions that still need a value are left out of what is sent, so a half-typed row never breaks the preview. */
export function completeFilters(group: FilterGroup | undefined, fields: CatalogField[]): FilterGroup | undefined {
  if (!group) return undefined;
  const items = group.items.flatMap((item): (Condition | FilterGroup)[] => {
    if (isGroup(item)) { const g = completeFilters(item, fields); return g ? [g] : []; }
    const f = fields.find((x) => x.path === item.field);
    const op = f ? opsFor(f.type).find((o) => o.op === item.op) : undefined;
    if (!f || !op) return [];
    const v = item.value;
    const filled = op.input === 'none' ? true
      : op.input === 'numbers' || op.input === 'dates' ? Array.isArray(v) && v[0] !== undefined && v[0] !== '' && v[1] !== undefined && v[1] !== ''
      : Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
    // The picker's display label travels with the condition (the server ignores it) so a saved filter shows names.
    return filled ? [item] : [];
  });
  return items.length ? { op: group.op, items } : undefined;
}
