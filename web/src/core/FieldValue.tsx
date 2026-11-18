// Read-only rendering of one field of a record, chosen by the field's type in /api/meta.
import { Link } from 'react-router-dom';
import type { Row } from './api';
import { EMPTY, formatCurrency, formatDate, formatDateTime, formatNumber, humanize, relativeTime } from './format';
import { LookupChip, recordHref, useMeta, type FieldMeta, type ResourceMeta } from './meta';
import './records.css';

const SYSTEM_FIELDS: Record<string, FieldMeta> = {
  created_at: { label: 'Created', type: 'datetime', readOnly: true },
  updated_at: { label: 'Updated', type: 'datetime', readOnly: true },
  created_by: { label: 'Created by', type: 'user', readOnly: true },
  updated_by: { label: 'Updated by', type: 'user', readOnly: true },
};

/** Field metadata, with sensible fallbacks for the standard columns and for unknown names. */
export function fieldMeta(resource: ResourceMeta, field: string): FieldMeta {
  return resource.fields[field] ?? SYSTEM_FIELDS[field] ?? { label: humanize(field), type: 'text' };
}

export interface FieldValueProps {
  resource: ResourceMeta;
  field: string;
  row: Row;
  /** One line only (table cells): long text is truncated, with the full text as a tooltip. */
  compact?: boolean;
}

export function FieldValue({ resource, field, row, compact }: FieldValueProps) {
  const { resources } = useMeta();
  const meta = fieldMeta(resource, field);
  const value = row[field];
  if (value === null || value === undefined || value === '') return <span className="rc-empty" aria-label="Empty">{EMPTY}</span>;
  const display = row._display?.[field];
  const oneLine = (text: string) => <span className="rc-truncate" title={text.length > 24 ? text : undefined}>{text}</span>;

  switch (meta.type) {
    case 'lookup':
      return meta.list ? <LookupChip list={meta.list} value={String(value)} /> : <>{display ?? String(value)}</>;
    case 'user':
      return compact ? oneLine(display ?? 'Unknown user') : <>{display ?? 'Unknown user'}</>;
    case 'ref': {
      const target = meta.to ? resources[meta.to] : undefined;
      const label = display ?? `Open ${(target?.label ?? 'record').toLowerCase()}`;
      if (!target) return compact ? oneLine(label) : <>{label}</>;
      return (
        <Link className={compact ? 'rc-truncate rc-cell-link' : undefined} title={compact && label.length > 24 ? label : undefined} to={recordHref(target.route, String(value))}>
          {label}
        </Link>
      );
    }
    case 'date':
      return <span className="rc-nowrap">{formatDate(value)}</span>;
    case 'datetime':
      return <time className="rc-nowrap" dateTime={String(value)} title={relativeTime(value)}>{formatDateTime(value)}</time>;
    case 'boolean':
      return <>{value ? 'Yes' : 'No'}</>;
    case 'currency':
      return <span className="rc-num">{formatCurrency(value)}</span>;
    case 'number':
      return <span className="rc-num">{formatNumber(value)}</span>;
    case 'json':
      return compact
        ? <span className="rc-empty">Structured data</span>
        : <pre className="rc-json">{JSON.stringify(value, null, 2)}</pre>;
    case 'longtext':
      return compact ? oneLine(String(value)) : <span className="rc-prose">{String(value)}</span>;
    default:
      return compact ? oneLine(String(value)) : <>{String(value)}</>;
  }
}
