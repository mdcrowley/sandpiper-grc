// Bulk actions of a ResourceList: the bar shown while rows are selected, the bulk edit dialog
// (one PATCH per row, with a progress summary) and CSV export of the selected rows.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, Group, List, Progress, Stack, Text } from '@mantine/core';
import { IconDownload, IconPencil, IconX } from '@tabler/icons-react';
import { csvCell } from '../../../shared/csv-guard.ts';
import { api, errorMessage, type Row } from './api';
import { DateField, LookupSelect, RecordPicker, Select, UserPicker } from './fields';
import { fieldMeta } from './FieldValue';
import { formatDate, formatDateTime } from './format';
import { allowedForAll, editableLifecycle } from './lifecycleMenus';
import { lookupLabel, useLookup, type ResourceMeta } from './meta';
import { Modal } from './overlay';

export const BULK_TYPES = ['lookup', 'user', 'ref', 'boolean', 'date'];

/* ---------- CSV of the selected rows ---------- */

function plainValue(resource: ResourceMeta, field: string, row: Row): unknown {
  const meta = fieldMeta(resource, field);
  const value = row[field];
  if (value === null || value === undefined || value === '') return '';
  switch (meta.type) {
    case 'lookup': return row._display?.[field] ?? (meta.list ? lookupLabel(meta.list, value) : value);
    case 'user':
    case 'ref': return row._display?.[field] ?? '';
    case 'date': return formatDate(value);
    case 'datetime': return formatDateTime(value);
    case 'boolean': return value ? 'Yes' : 'No';
    case 'json': return JSON.stringify(value);
    default: return value;
  }
}

/**
 * The CSV text of the given rows and field columns. Every cell goes through the server's formula guard
 * (shared/csv-guard.ts, W19): a cell a spreadsheet program could read as a formula is shown as text.
 */
export function rowsCsv(resource: ResourceMeta, fields: string[], rows: Row[]): string {
  const lines = [
    fields.map((f) => csvCell(fieldMeta(resource, f).label)).join(','),
    ...rows.map((row) => fields.map((f) => csvCell(plainValue(resource, f, row))).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** Save the given rows as a CSV file with the given field columns. */
export function downloadRowsCsv(resource: ResourceMeta, fields: string[], rows: Row[], fileName: string): void {
  const blob = new Blob(['﻿', rowsCsv(resource, fields, rows)], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(href);
}

/* ---------- Bar ---------- */

export interface BulkBarProps {
  count: number;
  noun: string;
  canEdit: boolean;
  canExport: boolean;
  onEdit: () => void;
  onExport: () => void;
  onClear: () => void;
  /** Extra buttons (ResourceList's `bulkActions`), before Clear selection. */
  extra?: ReactNode;
}

export function BulkBar({ count, noun, canEdit, canExport, onEdit, onExport, onClear, extra }: BulkBarProps) {
  return (
    <div className="rc-bulk" role="region" aria-label="Bulk actions">
      <Text size="sm" fw={600} role="status">{count} {noun} selected</Text>
      <Group gap="xs">
        {canEdit && <Button size="xs" leftSection={<IconPencil size={14} aria-hidden="true" />} onClick={onEdit}>Edit selected…</Button>}
        {canExport && <Button size="xs" variant="default" leftSection={<IconDownload size={14} aria-hidden="true" />} onClick={onExport}>Export selected</Button>}
        {extra}
        <Button size="xs" variant="subtle" leftSection={<IconX size={14} aria-hidden="true" />} onClick={onClear}>Clear selection</Button>
      </Group>
    </div>
  );
}

/* ---------- Bulk edit ---------- */

export interface BulkEditDialogProps {
  open: boolean;
  resource: ResourceMeta;
  rows: Row[];
  /** Fields that may be changed in bulk. */
  fields: string[];
  onClose: () => void;
  /** Called after a run, with the number of rows changed. */
  onDone: (changed: number) => void;
}

interface Run {
  total: number;
  done: number;
  changed: number;
  unchanged: number;
  failed: { label: string; message: string }[];
  finished: boolean;
}

export function BulkEditDialog({ open, resource, rows, fields, onClose, onDone }: BulkEditDialogProps) {
  const [field, setField] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [clear, setClear] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const stop = useRef(false);

  const meta = field ? fieldMeta(resource, field) : undefined;
  const noun = (n: number) => (n === 1 ? resource.label : resource.plural).toLowerCase();
  // The lifecycle's status field (E14-31): offer only the statuses every selected record may move to.
  const lifecycle = meta?.type === 'lookup' ? editableLifecycle(resource.lifecycle, field) : undefined;
  const statusList = useLookup(lifecycle ? meta?.list ?? '' : '');
  const allowed = useMemo(
    () => (lifecycle ? allowedForAll(lifecycle, rows.map((r) => r[field] as string | null | undefined), statusList.map((v) => v.value)) : undefined),
    [lifecycle, rows, field, statusList],
  );
  const noStatus = allowed !== undefined && allowed.length === 0;
  const ready = Boolean(meta) && (clear || (value !== null && value !== '' && (!allowed || allowed.includes(value))));
  const running = run !== null && !run.finished;

  const close = () => {
    if (running) {
      stop.current = true;
      return;
    }
    setField('');
    setValue(null);
    setClear(false);
    setRun(null);
    onClose();
  };

  const apply = async () => {
    if (!meta || !ready) return;
    const next: unknown = clear ? null : meta.type === 'boolean' ? value === 'true' : value;
    const state: Run = { total: rows.length, done: 0, changed: 0, unchanged: 0, failed: [], finished: false };
    stop.current = false;
    setRun({ ...state });
    for (const row of rows) {
      if (stop.current) break;
      const before = row[field] ?? null;
      if (before === next || (meta.type === 'date' && typeof before === 'string' && before.slice(0, 10) === next)) {
        state.unchanged += 1;
      } else {
        try {
          await api.patch(`${resource.path}/${row.id}`, { [field]: next });
          state.changed += 1;
        } catch (err) {
          const label = [resource.refField ? row[resource.refField] : '', row[resource.titleField]].filter(Boolean).join(' ') || 'A record';
          state.failed.push({ label: String(label), message: errorMessage(err) });
        }
      }
      state.done += 1;
      setRun({ ...state, failed: [...state.failed] });
    }
    state.finished = true;
    setRun({ ...state, failed: [...state.failed] });
    onDone(state.changed);
  };

  const control = () => {
    if (!meta) return null;
    const common = { label: `New ${meta.label.toLowerCase()}`, disabled: clear };
    switch (meta.type) {
      case 'lookup': {
        if (noStatus) {
          const list = meta.list ?? '';
          const current = [...new Set(rows.map((r) => lookupLabel(list, r[field]) || 'none'))].join(', ');
          return (
            <Alert color="yellow" variant="light" role="status">
              No {meta.label.toLowerCase()} can be given to all the selected {noun(rows.length)}: the lifecycle rules
              (Administration &gt; Lifecycles) leave no move open from every current {meta.label.toLowerCase()} ({current}).
              Select fewer {noun(2)}, for example those with the same {meta.label.toLowerCase()}.
            </Alert>
          );
        }
        return <LookupSelect {...common} list={meta.list ?? ''} only={allowed} value={value ?? ''} onChange={(v) => setValue(v || null)} />;
      };
      case 'user': return <UserPicker {...common} value={value} onChange={(id) => setValue(id)} />;
      case 'ref': return <RecordPicker {...common} type={meta.to ?? ''} value={value} onChange={(id) => setValue(id)} />;
      case 'date': return <DateField {...common} value={value ?? ''} onChange={(v) => setValue(v || null)} />;
      case 'boolean':
        return <Select {...common} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} value={value ?? ''} onChange={(v) => setValue(v || null)} />;
      default: return null;
    }
  };

  const skipped = run ? run.total - run.done : 0;
  return (
    <Modal open={open} title={`Edit ${rows.length} ${noun(rows.length)}`} size="md" onClose={close}>
      {run === null ? (
        <form
          className="rc-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void apply();
          }}
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Choose one field and the value to give every selected {resource.label.toLowerCase()}. Each change is recorded in that record's history.
            </Text>
            <Select
              label="Field to change"
              placeholder="Choose a field"
              required
              options={fields.map((f) => ({ value: f, label: fieldMeta(resource, f).label }))}
              value={field}
              onChange={(v) => { setField(v); setValue(null); setClear(false); }}
            />
            {control()}
            {meta && !meta.required && meta.type !== 'boolean' && (
              <Checkbox label={`Clear ${meta.label.toLowerCase()} instead (leave it empty)`} checked={clear} onChange={(e) => setClear(e.currentTarget.checked)} />
            )}
          </Stack>
          <div className="rc-form-actions">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!ready}>Apply to {rows.length} {noun(rows.length)}</Button>
          </div>
        </form>
      ) : (
        <Stack gap="md">
          <Progress value={run.total ? (run.done / run.total) * 100 : 100} aria-label="Bulk edit progress" animated={running} />
          <Text size="sm" role="status" aria-live="polite">
            {running
              ? `Updating ${run.done + 1 > run.total ? run.total : run.done + 1} of ${run.total}…`
              : `${run.changed} updated${run.unchanged ? `, ${run.unchanged} already had this value` : ''}${run.failed.length ? `, ${run.failed.length} could not be changed` : ''}${skipped ? `, ${skipped} not attempted (stopped)` : ''}.`}
          </Text>
          {run.failed.length > 0 && (
            <Alert color="red" variant="light" title="Not changed">
              <List size="sm" spacing={4}>
                {run.failed.slice(0, 20).map((f, i) => <List.Item key={i}><strong>{f.label}</strong>: {f.message}</List.Item>)}
                {run.failed.length > 20 && <List.Item>and {run.failed.length - 20} more</List.Item>}
              </List>
            </Alert>
          )}
          <div className="rc-form-actions">
            {running
              ? <Button variant="default" onClick={() => { stop.current = true; }}>Stop</Button>
              : <Button onClick={close}>Done</Button>}
          </div>
        </Stack>
      )}
    </Modal>
  );
}
