// History of one record: who changed what and when, as readable before → after lines.
import { useState } from 'react';
import { Avatar, Button, Text } from '@mantine/core';
import { IconArrowNarrowRight } from '@tabler/icons-react';
import { qs, type Row } from './api';
import { fieldMeta } from './FieldValue';
import { EMPTY, formatCurrency, formatDate, formatDateTime, relativeTime } from './format';
import { useFetch } from './hooks';
import { rememberLabel, useLabels, type LabelTarget } from './labels';
import { lookupLabel, useMeta, useResource, type ResourceMeta } from './meta';
import { EmptyState, ErrorState, Loading } from './ui';
import './records.css';

export const recordQuery = (type: string, id: string) => qs({ record_type: type, record_id: id });

export interface HistoryEvent {
  id: string;
  at: string;
  actor_name: string | null;
  action: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const HOUSEKEEPING = ['updated_at', 'updated_by', 'created_at', 'created_by', 'deleted_at', 'id'];
const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

/** Which label store an id in this field belongs to ('' when it is not an id). */
function labelKind(resource: ResourceMeta | undefined, field: string, values: Record<string, unknown> | null): string {
  if (field === 'to_id' && typeof values?.to_type === 'string') return values.to_type; // link events
  const meta = resource ? fieldMeta(resource, field) : undefined;
  if (meta?.type === 'user') return 'user';
  if (meta?.type === 'ref') return meta.to ?? '';
  return '';
}

function changedFields(event: HistoryEvent): string[] {
  const all = [...new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})])].filter((f) => !HOUSEKEEPING.includes(f));
  // A creation lists every field: keep only the ones that were given a value.
  if (!event.before) return all.filter((f) => !isEmpty(event.after?.[f]));
  if (!event.after) return all.filter((f) => !isEmpty(event.before?.[f]));
  return all.filter((f) => JSON.stringify(event.before?.[f] ?? null) !== JSON.stringify(event.after?.[f] ?? null));
}

/** Every user or record id mentioned in these events, so their names can be looked up. */
export function historyTargets(events: HistoryEvent[], resource: ResourceMeta | undefined): LabelTarget[] {
  const out: LabelTarget[] = [];
  for (const event of events) {
    for (const side of [event.before, event.after]) {
      for (const [field, value] of Object.entries(side ?? {})) {
        const kind = labelKind(resource, field, side);
        if (kind && typeof value === 'string' && value) out.push({ kind, id: value });
      }
    }
  }
  return out;
}

interface ValueContext {
  resource: ResourceMeta | undefined;
  resources: Record<string, ResourceMeta>;
  labels: Record<string, string>;
}

function historyValue(ctx: ValueContext, field: string, value: unknown, side: Record<string, unknown> | null): string {
  if (isEmpty(value)) return EMPTY;
  const kind = labelKind(ctx.resource, field, side);
  if (kind) {
    const label = ctx.labels[`${kind}:${String(value)}`];
    if (label) return label;
    return kind === 'user' ? 'Another user' : `Another ${(ctx.resources[kind]?.label ?? 'record').toLowerCase()}`;
  }
  if (field === 'to_type' && typeof value === 'string') return ctx.resources[value]?.label ?? value;
  const meta = ctx.resource ? fieldMeta(ctx.resource, field) : undefined;
  switch (meta?.type) {
    case 'lookup': return meta.list ? lookupLabel(meta.list, value) : String(value);
    case 'date': return formatDate(String(value));
    case 'datetime': return formatDateTime(String(value));
    case 'boolean': return value ? 'Yes' : 'No';
    case 'currency': return formatCurrency(value as number);
    default: {
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    }
  }
}

const FIELD_NAMES: Record<string, string> = { to_type: 'Record type', to_id: 'Record', relation: 'Relation' };

function Changes({ event, ctx }: { event: HistoryEvent; ctx: ValueContext }) {
  const [all, setAll] = useState(false);
  const fields = changedFields(event);
  if (fields.length === 0) return null;
  const shown = all ? fields : fields.slice(0, 6);
  return (
    <>
      <dl className="rc-changes">
        {shown.map((field) => {
          const hadBefore = event.before !== null && field in event.before;
          const after = historyValue(ctx, field, event.after?.[field], event.after);
          return (
            <div key={field} className="rc-change">
              <dt>{FIELD_NAMES[field] ?? (ctx.resource ? fieldMeta(ctx.resource, field).label : field)}</dt>
              <dd>
                {hadBefore && event.after !== null && (
                  <>
                    <span className="rc-change-before">{historyValue(ctx, field, event.before?.[field], event.before)}</span>
                    <IconArrowNarrowRight size={14} className="rc-change-arrow" aria-hidden="true" />
                    <span className="rc-sr-only"> changed to </span>
                  </>
                )}
                {event.after === null
                  ? <span className="rc-change-before">{historyValue(ctx, field, event.before?.[field], event.before)}</span>
                  : <span className="rc-change-after">{after}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {fields.length > 6 && (
        <Button variant="subtle" size="compact-xs" mt={4} aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show ${fields.length - 6} more`}
        </Button>
      )}
    </>
  );
}

/** "3 hours ago", with the exact time on hover and for assistive technology. */
export function When({ at }: { at: string }) {
  return <time className="rc-when" dateTime={at} title={formatDateTime(at)}>{relativeTime(at)}</time>;
}

export function HistoryEntry({ event, ctx }: { event: HistoryEvent; ctx: ValueContext }) {
  const who = event.actor_name ?? 'System';
  return (
    <li className="rc-tl-item rc-tl-event">
      <Avatar name={who} color={event.actor_name ? 'initials' : 'gray'} size={28} radius="xl" className="rc-tl-avatar" aria-hidden="true" />
      <div className="rc-tl-body">
        <p className="rc-tl-head">
          <strong>{who}</strong> <span className="rc-tl-summary">{lowerFirst(event.summary ?? event.action)}</span>
          <span className="rc-tl-sep" aria-hidden="true">·</span>
          <When at={event.at} />
        </p>
        <Changes event={event} ctx={ctx} />
      </div>
    </li>
  );
}

function lowerFirst(text: string): string {
  // "Ticket updated" reads better after a name as "updated the ticket"; keep the server's words, soften the capital.
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Shared by the History and Activity panels: names for the ids that the events mention. */
export function useHistoryContext(type: string, events: HistoryEvent[] | undefined, row?: Row): ValueContext {
  const resource = useResource(type);
  const { resources } = useMeta();
  if (row && resource) {
    for (const [field, label] of Object.entries(row._display ?? {})) {
      const kind = labelKind(resource, field, null);
      if (kind && typeof row[field] === 'string') rememberLabel(kind, row[field], label);
    }
  }
  const labels = useLabels(historyTargets(events ?? [], resource), resources);
  return { resource, resources, labels };
}

export interface PanelProps {
  /** Record type key. */
  type: string;
  /** Record id. */
  id: string;
}

export interface HistoryPanelProps extends PanelProps {
  /** The record, when you have it: its `_display` labels name the current users and records. */
  row?: Row;
}

/** The audit trail of one record: who changed what and when, with before and after values. */
export function HistoryPanel({ type, id, row }: HistoryPanelProps) {
  const { data, error, reload } = useFetch<HistoryEvent[]>(`/api/history${recordQuery(type, id)}`);
  const ctx = useHistoryContext(type, data, row);
  if (error) return <ErrorState title="History could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading history" />;
  if (data.length === 0) return <EmptyState icon="history" title="No history yet" message="Changes to this record will be listed here." />;
  return (
    <div className="rc-history">
      <Text size="sm" c="dimmed" mb="sm">{data.length} {data.length === 1 ? 'entry' : 'entries'}, newest first. History cannot be edited.</Text>
      <ol className="rc-timeline">
        {data.map((event) => <HistoryEntry key={event.id} event={event} ctx={ctx} />)}
      </ol>
    </div>
  );
}
