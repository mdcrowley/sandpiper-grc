// Filters of a ResourceList: the "Filters" popover (add and change) and the row of removable pills.
import { useState } from 'react';
import { Anchor, Button, Chip, Group, Pill, Popover, ScrollArea, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconFilter } from '@tabler/icons-react';
import { useAuth } from './auth';
import { ColorDot, DateField, InlinePopups, RecordPicker, UserPicker } from './fields';
import { fieldMeta } from './FieldValue';
import { formatDate, humanize } from './format';
import { knownLabel, rememberLabel, useLabels, type LabelTarget } from './labels';
import type { View } from './listState';
import { lookupLabel, useLookup, useMeta, type FieldMeta, type ResourceMeta } from './meta';

export type SetFilter = (key: string, values: string[], label?: string) => void;

interface FilterProps {
  resource: ResourceMeta;
  view: View;
  setFilter: SetFilter;
}

const FILTERABLE = ['lookup', 'boolean', 'user', 'ref', 'date', 'datetime'];

/** Which label store a field's ids belong to. */
const kindOf = (meta: FieldMeta) => (meta.type === 'user' ? 'user' : meta.to ?? '');

function LookupChips({ meta, value, onChange }: { meta: FieldMeta; value: string[]; onChange: (v: string[]) => void }) {
  const options = useLookup(meta.list ?? '');
  if (options.length === 0) return <Text size="sm" c="dimmed">No values configured</Text>;
  return (
    <Chip.Group multiple value={value} onChange={onChange}>
      <Group gap={6}>
        {options.map((o) => (
          <Chip key={o.value} value={o.value} size="xs" variant="outline">
            <span className="rc-option"><ColorDot color={o.color} />{o.label}</span>
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  );
}

function FilterControl({ resource, field, view, setFilter }: FilterProps & { field: string }) {
  const meta = fieldMeta(resource, field);
  const { user } = useAuth();
  const value = view.filters[field] ?? [];
  const kind = kindOf(meta);
  const pick = (id: string | null, option?: { label: string }) => setFilter(field, id ? [id] : [], option?.label);
  const display = value[0] ? knownLabel(kind, value[0]) ?? view.labels[field] : undefined;

  switch (meta.type) {
    case 'lookup':
      return (
        <div role="group" aria-label={meta.label}>
          <Text size="sm" fw={500} mb={6}>{meta.label}</Text>
          <LookupChips meta={meta} value={value} onChange={(v) => setFilter(field, v)} />
        </div>
      );
    case 'boolean':
      return (
        <div role="group" aria-label={meta.label}>
          <Text size="sm" fw={500} mb={6}>{meta.label}</Text>
          <SegmentedControl
            size="xs"
            aria-label={meta.label}
            data={[{ value: '', label: 'Any' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
            value={value[0] ?? ''}
            onChange={(v) => setFilter(field, v ? [v] : [])}
          />
        </div>
      );
    case 'user':
      return (
        <div>
          <UserPicker label={meta.label} placeholder="Anyone" value={value[0] ?? null} display={display} onChange={pick} />
          {user && value[0] !== user.id && (
            <Anchor component="button" type="button" size="xs" mt={4} onClick={() => setFilter(field, [user.id], user.displayName)}>
              Me ({user.displayName})
            </Anchor>
          )}
        </div>
      );
    case 'ref':
      return <RecordPicker type={meta.to ?? ''} label={meta.label} placeholder="Any" value={value[0] ?? null} display={display} onChange={pick} />;
    case 'date':
    case 'datetime':
      return (
        <div role="group" aria-label={meta.label} className="rc-filter-dates">
          <DateField label={`${meta.label} after`} placeholder="Any date" value={view.filters[`${field}.gt`]?.[0] ?? ''} onChange={(v) => setFilter(`${field}.gt`, v ? [v] : [])} />
          <DateField label={`${meta.label} before`} placeholder="Any date" value={view.filters[`${field}.lt`]?.[0] ?? ''} onChange={(v) => setFilter(`${field}.lt`, v ? [v] : [])} />
        </div>
      );
    default:
      return null; // text fields are covered by the search box
  }
}

/** The "Filters" button and its popover with one control per filterable field. */
export function FilterButton({ resource, view, setFilter, fields, onClear }: FilterProps & { fields: string[]; onClear: () => void }) {
  const [opened, setOpened] = useState(false);
  const usable = fields.filter((f) => FILTERABLE.includes(fieldMeta(resource, f).type));
  const active = Object.keys(view.filters).filter((k) => view.filters[k].length > 0).length;
  if (usable.length === 0) return null;
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md" width={360} trapFocus returnFocus>
      <Popover.Target>
        <Button
          variant={active > 0 ? 'light' : 'default'}
          leftSection={<IconFilter size={16} aria-hidden="true" />}
          aria-expanded={opened}
          aria-haspopup="dialog"
          onClick={() => setOpened((o) => !o)}
        >
          Filters
          {active > 0 && <span className="rc-count" aria-label={`${active} active`}>{active}</span>}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={0} aria-label={`Filter ${resource.plural.toLowerCase()}`}>
        <ScrollArea.Autosize mah="min(70vh, 520px)" type="auto">
          <InlinePopups>
            <Stack gap="md" p="md">
              {usable.map((f) => <FilterControl key={f} resource={resource} field={f} view={view} setFilter={setFilter} />)}
            </Stack>
          </InlinePopups>
        </ScrollArea.Autosize>
        <Group justify="space-between" p="xs" className="rc-popover-foot">
          <Button variant="subtle" size="xs" disabled={active === 0} onClick={onClear}>Clear all filters</Button>
          <Button size="xs" onClick={() => setOpened(false)}>Done</Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

interface PillInfo {
  key: string;
  text: string;
}

/** Active filters as removable pills. Also shows filters that came in through the address. */
export function FilterPills({ resource, view, setFilter, onClear }: FilterProps & { onClear: () => void }) {
  const { resources } = useMeta();
  const entries = Object.entries(view.filters).filter(([, v]) => v.length > 0);

  const targets: LabelTarget[] = [];
  for (const [key, values] of entries) {
    const meta = fieldMeta(resource, key);
    if (!key.includes('.') && (meta.type === 'user' || meta.type === 'ref')) {
      for (const id of values) targets.push({ kind: kindOf(meta), id });
    }
  }
  for (const [key, label] of Object.entries(view.labels)) {
    const meta = fieldMeta(resource, key);
    const id = view.filters[key]?.[0];
    if (id && label && (meta.type === 'user' || meta.type === 'ref')) rememberLabel(kindOf(meta), id, label);
  }
  const labels = useLabels(targets, resources);

  if (entries.length === 0 && !view.q) return null;

  const pills: PillInfo[] = entries.map(([key, values]) => {
    const [field, op] = key.split('.');
    const meta = fieldMeta(resource, field);
    const name = meta.label || humanize(field);
    if (op === 'gt') return { key, text: `${name} after ${formatDate(values[0])}` };
    if (op === 'lt') return { key, text: `${name} before ${formatDate(values[0])}` };
    if (op === 'null') return { key, text: `${name}: ${values[0] === 'true' ? 'empty' : 'has a value'}` };
    let shown: string[];
    switch (meta.type) {
      case 'lookup': shown = values.map((v) => (meta.list ? lookupLabel(meta.list, v) : v)); break;
      case 'boolean': shown = [values[0] === 'true' ? 'Yes' : 'No']; break;
      case 'user':
      case 'ref': shown = values.map((id) => labels[`${kindOf(meta)}:${id}`] ?? '…'); break;
      default: shown = values;
    }
    return { key, text: `${name}: ${shown.join(', ')}` };
  });

  return (
    <div className="rc-pills" role="group" aria-label="Active filters">
      {view.q && (
        <Pill withRemoveButton onRemove={() => setFilter('__q', [])} removeButtonProps={{ 'aria-label': 'Remove search' }}>
          Search: “{view.q}”
        </Pill>
      )}
      {pills.map((p) => (
        <Pill key={p.key} withRemoveButton onRemove={() => setFilter(p.key, [])} removeButtonProps={{ 'aria-label': `Remove filter ${p.text}` }}>
          {p.text}
        </Pill>
      ))}
      <Button variant="subtle" size="compact-xs" onClick={onClear}>Clear all</Button>
    </div>
  );
}
