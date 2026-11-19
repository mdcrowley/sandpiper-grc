// The table of a ResourceList: sticky sortable header, row selection, keyboard navigation,
// plus its loading skeleton and the column chooser.
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionIcon, Button, Checkbox, Group, Popover, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconColumns3, IconSelector } from '@tabler/icons-react';
import type { Row } from './api';
import { FieldValue } from './FieldValue';
import { recordHref, type ResourceMeta } from './meta';

export interface ListColumn {
  field: string;
  label: string;
  render?: (row: Row) => ReactNode;
  sortable: boolean;
  align: 'left' | 'right';
  /** A real field of the record type (not a render-only column). */
  known: boolean;
  startHidden: boolean;
}

export type Density = 'comfortable' | 'compact';

const spacing = (density: Density) => (density === 'compact' ? 5 : 10);

/* ---------- Column chooser ---------- */

export interface ColumnChooserProps {
  columns: ListColumn[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onReset: () => void;
}

export function ColumnChooser({ columns, hidden, onChange, onReset }: ColumnChooserProps) {
  const [opened, setOpened] = useState(false);
  const shown = columns.filter((c) => !hidden.includes(c.field)).length;
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" shadow="md" trapFocus returnFocus>
      <Popover.Target>
        <Tooltip label="Choose columns" disabled={opened}>
          <ActionIcon variant="default" size="lg" aria-label="Choose columns" aria-expanded={opened} aria-haspopup="dialog" onClick={() => setOpened((o) => !o)}>
            <IconColumns3 size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm" aria-label="Columns">
        <fieldset className="rc-multi">
          <legend className="rc-legend">Columns</legend>
          <Stack gap={8}>
            {columns.map((c) => {
              const on = !hidden.includes(c.field);
              return (
                <Checkbox
                  key={c.field}
                  size="sm"
                  label={c.label}
                  checked={on}
                  disabled={on && shown <= 1}
                  onChange={() => onChange(on ? [...hidden, c.field] : hidden.filter((f) => f !== c.field))}
                />
              );
            })}
          </Stack>
        </fieldset>
        <Group justify="space-between" mt="sm" gap="xs">
          <Button variant="subtle" size="compact-xs" onClick={onReset}>Reset</Button>
          <Text size="xs" c="dimmed">Remembered on this device</Text>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

/* ---------- Skeleton ---------- */

export function TableSkeleton({ columns, density, label, selectable, rows = 8 }: {
  columns: ListColumn[]; density: Density; label: string; selectable?: boolean; rows?: number;
}) {
  return (
    <div className="rc-table-wrap" role="status" aria-live="polite">
      <span className="rc-sr-only">{label}…</span>
      <Table verticalSpacing={spacing(density)} horizontalSpacing="md" aria-hidden="true">
        <Table.Thead>
          <Table.Tr>
            {selectable && <Table.Th className="rc-th rc-check-cell" />}
            {columns.map((c) => <Table.Th key={c.field} className={`rc-th${c.align === 'right' ? ' rc-right' : ''}`}><span className="rc-th-text">{c.label}</span></Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Array.from({ length: rows }, (_, r) => (
            <Table.Tr key={r}>
              {selectable && <Table.Td className="rc-check-cell"><Skeleton height={16} width={16} radius="sm" /></Table.Td>}
              {columns.map((c, i) => (
                <Table.Td key={c.field}>
                  <Skeleton height={12} radius="xl" width={`${45 + ((r * 13 + i * 29) % 45)}%`} ml={c.align === 'right' ? 'auto' : undefined} />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

/* ---------- Table ---------- */

export interface ListTableProps {
  resource: ResourceMeta;
  caption: string;
  columns: ListColumn[];
  rows: Row[];
  busy: boolean;
  density: Density;
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (field: string) => void;
  onOpen: (row: Row) => void;
  /** Title and reference cells link to the record page. */
  linkTitles: boolean;
  selectable: boolean;
  selected: Map<string, Row>;
  onSelect: (next: Map<string, Row>) => void;
}

export function ListTable({
  resource, caption, columns, rows, busy, density, sort, dir, onSort, onOpen, linkTitles, selectable, selected, onSelect,
}: ListTableProps) {
  const [active, setActive] = useState(0);
  const current = Math.min(active, rows.length - 1);

  const onPage = rows.filter((r) => selected.has(r.id)).length;
  const toggle = (row: Row) => {
    const next = new Map(selected);
    if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row);
    onSelect(next);
  };
  const toggleAll = () => {
    const next = new Map(selected);
    if (onPage === rows.length) rows.forEach((r) => next.delete(r.id));
    else rows.forEach((r) => next.set(r.id, r));
    onSelect(next);
  };

  const onRowMouse = (e: MouseEvent, row: Row) => {
    if ((e.target as HTMLElement).closest('a, button, input, select, label, [data-no-row-click]')) return;
    if (window.getSelection()?.toString()) return; // the user is selecting text, not opening the row
    onOpen(row);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: Row, index: number) => {
    if (e.target !== e.currentTarget) return;
    const move = (to: number) => {
      e.preventDefault();
      const clamped = Math.max(0, Math.min(rows.length - 1, to));
      setActive(clamped);
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('tr')[clamped]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown': move(index + 1); break;
      case 'ArrowUp': move(index - 1); break;
      case 'Home': move(0); break;
      case 'End': move(rows.length - 1); break;
      case 'Enter': e.preventDefault(); onOpen(row); break;
      case ' ':
        if (selectable) { e.preventDefault(); toggle(row); }
        break;
      default:
    }
  };

  const titleLink = (field: string) => linkTitles && (field === resource.titleField || field === resource.refField);

  return (
    <div className="rc-table-wrap" aria-busy={busy} data-busy={busy || undefined} tabIndex={-1}>
      <Table
        className="rc-table"
        verticalSpacing={spacing(density)}
        horizontalSpacing="md"
        striped
        highlightOnHover
        stickyHeader
      >
        <caption className="rc-sr-only">
          {caption}. Use the arrow keys to move between rows, Enter to open{selectable ? ', Space to select' : ''}.
        </caption>
        <Table.Thead>
          <Table.Tr>
            {selectable && (
              <Table.Th className="rc-th rc-check-cell">
                <Checkbox
                  size="xs"
                  aria-label="Select all rows on this page"
                  checked={onPage === rows.length && rows.length > 0}
                  indeterminate={onPage > 0 && onPage < rows.length}
                  onChange={toggleAll}
                />
              </Table.Th>
            )}
            {columns.map((c) => {
              const sorted = sort === c.field;
              return (
                <Table.Th
                  key={c.field}
                  scope="col"
                  className={`rc-th${c.align === 'right' ? ' rc-right' : ''}`}
                  aria-sort={sorted ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortable ? (
                    <UnstyledButton className="rc-sort" data-sorted={sorted || undefined} onClick={() => onSort(c.field)}
                      title={sorted ? (dir === 'asc' ? 'Sorted ascending: click for descending' : 'Sorted descending: click to clear') : 'Sort by this column'}>
                      <span className="rc-th-text">{c.label}</span>
                      {sorted
                        ? (dir === 'asc' ? <IconArrowUp size={14} aria-hidden="true" /> : <IconArrowDown size={14} aria-hidden="true" />)
                        : <IconSelector size={14} className="rc-sort-idle" aria-hidden="true" />}
                    </UnstyledButton>
                  ) : <span className="rc-th-text">{c.label}</span>}
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row, index) => {
            const isSelected = selected.has(row.id);
            return (
              <Table.Tr
                key={row.id}
                className="rc-row"
                tabIndex={index === current ? 0 : -1}
                data-selected={isSelected || undefined}
                onFocus={(e) => { if (e.target === e.currentTarget) setActive(index); }}
                onClick={(e) => onRowMouse(e, row)}
                onKeyDown={(e) => onRowKey(e, row, index)}
              >
                {selectable && (
                  <Table.Td className="rc-check-cell" data-no-row-click onClick={(e) => { if (e.target === e.currentTarget) toggle(row); }}>
                    <Checkbox
                      size="xs"
                      tabIndex={-1}
                      aria-label={`Select ${row[resource.refField ?? ''] ?? row[resource.titleField] ?? 'row'}`}
                      checked={isSelected}
                      onChange={() => toggle(row)}
                    />
                  </Table.Td>
                )}
                {columns.map((c) => {
                  const raw = row[c.field];
                  const linked = !c.render && titleLink(c.field) && raw;
                  return (
                    <Table.Td key={c.field} className={`rc-td${c.align === 'right' ? ' rc-right' : ''}${c.field === resource.titleField ? ' rc-td-title' : ''}`}>
                      {c.render ? c.render(row)
                        : linked ? (
                          <Link
                            className={c.field === resource.refField ? 'rc-ref rc-cell-link' : 'rc-row-title rc-cell-link'}
                            to={recordHref(resource.route, row.id)}
                            tabIndex={-1}
                            title={c.field === resource.titleField ? String(raw) : undefined}
                          >
                            {String(raw)}
                          </Link>
                        ) : <FieldValue resource={resource} field={c.field} row={row} compact />}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </div>
  );
}
