// Record detail page and its ready-made panels: activity, history, related records, editable summary.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, errorMessage, qs, type Row } from './api';
import { useAuth } from './auth';
import { Checkbox, LookupSelect, RecordPicker, Select, TextArea, TextField } from './fields';
import { fieldMeta, FieldValue } from './FieldValue';
import { EMPTY, formatDate, formatDateTime, relativeTime } from './format';
import { useFetch, useRecord } from './hooks';
import { LookupChip, lookupLabel, recordHref, useMeta, useResource, type ResourceMeta } from './meta';
import { ConfirmDialog, useToast } from './overlay';
import { ResourceForm } from './ResourceForm';
import {
  Badge, Button, Card, DefinitionList, EmptyState, ErrorState, IconButton, Loading, PageHeader, Tabs,
  type Crumb, type TabItem,
} from './ui';

const recordQuery = (type: string, id: string) => qs({ record_type: type, record_id: id });

/* ---------- Editable summary ---------- */

export interface EditableSummaryProps {
  type: string;
  row: Row;
  /** Fields to show, and to edit when the user presses Edit. */
  fields: string[];
  /** Called with the saved row; usually `reload` from useRecord. */
  onSaved?: (row: Row) => void;
  title?: string;
  /** Defaults to whether the user holds `<module>.edit`. */
  editable?: boolean;
}

/** A definition list of the given fields that flips into a form. */
export function EditableSummary({ type, row, fields, onSaved, title = 'Details', editable }: EditableSummaryProps) {
  const resource = useResource(type);
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;
  const canEdit = editable ?? can(`${resource.module}.edit`);

  return (
    <Card
      title={title}
      actions={canEdit && !editing && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
    >
      {editing ? (
        <ResourceForm
          type={type}
          id={row.id}
          fields={fields}
          initial={row}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            toast.success('Changes saved.');
            onSaved?.(saved);
          }}
        />
      ) : (
        <DefinitionList
          items={fields.map((field) => {
            const meta = fieldMeta(resource, field);
            return {
              label: meta.label,
              value: <FieldValue resource={resource} field={field} row={row} />,
              wide: meta.type === 'longtext' || meta.type === 'json',
            };
          })}
        />
      )}
    </Card>
  );
}

/* ---------- History ---------- */

interface HistoryEvent {
  id: string;
  at: string;
  actor_name: string | null;
  action: string;
  summary: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function historyValue(resource: ResourceMeta | undefined, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const meta = resource ? fieldMeta(resource, field) : undefined;
  switch (meta?.type) {
    case 'lookup': return meta.list ? lookupLabel(meta.list, value) : String(value);
    case 'date': return formatDate(String(value));
    case 'datetime': return formatDateTime(String(value));
    case 'boolean': return value ? 'Yes' : 'No';
    case 'user':
    case 'ref': return 'set'; // history stores ids, not names
    default: {
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return text.length > 160 ? `${text.slice(0, 160)}…` : text;
    }
  }
}

function ChangeTable({ event, resource }: { event: HistoryEvent; resource: ResourceMeta | undefined }) {
  const fields = [...new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})])]
    .filter((f) => !['updated_at', 'updated_by', 'created_at', 'created_by', 'id'].includes(f));
  if (fields.length === 0) return null;
  return (
    <ul className="changes">
      {fields.map((field) => (
        <li key={field}>
          <span className="changes-field">{resource ? fieldMeta(resource, field).label : field}</span>
          {event.before && field in event.before && (
            <>
              <span className="changes-before">{historyValue(resource, field, event.before[field])}</span>
              <span aria-hidden="true">→</span>
              <span className="sr-only">changed to</span>
            </>
          )}
          <span className="changes-after">{historyValue(resource, field, event.after?.[field])}</span>
        </li>
      ))}
    </ul>
  );
}

function HistoryEntry({ event, resource }: { event: HistoryEvent; resource: ResourceMeta | undefined }) {
  return (
    <li className="timeline-item">
      <div className="timeline-head">
        <strong>{event.actor_name ?? 'System'}</strong>
        <span>{event.summary ?? event.action}</span>
        <time className="muted" dateTime={event.at} title={relativeTime(event.at)}>{formatDateTime(event.at)}</time>
      </div>
      <ChangeTable event={event} resource={resource} />
    </li>
  );
}

export interface PanelProps {
  /** Record type key. */
  type: string;
  /** Record id. */
  id: string;
}

/** The audit trail of one record: who changed what and when, with before and after values. */
export function HistoryPanel({ type, id }: PanelProps) {
  const resource = useResource(type);
  const { data, error, reload } = useFetch<HistoryEvent[]>(`/api/history${recordQuery(type, id)}`);
  if (error) return <ErrorState title="History could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading history" />;
  if (data.length === 0) return <EmptyState icon="history" title="No history yet" message="Changes to this record will be listed here." />;
  return (
    <ol className="timeline">
      {data.map((event) => <HistoryEntry key={event.id} event={event} resource={resource} />)}
    </ol>
  );
}

/* ---------- Activity ---------- */

interface Comment {
  id: string;
  body: string;
  internal: boolean;
  author_name: string | null;
  created_at: string;
}

export interface ActivityPanelProps extends PanelProps {
  /** Whether new comments start as internal notes (default true, the safer choice). */
  defaultInternal?: boolean;
  /** Hide the internal/public choice and make every comment internal. */
  internalOnly?: boolean;
}

/** Comments and record history merged into one timeline (newest first), with an add-comment box. */
export function ActivityPanel({ type, id, defaultInternal = true, internalOnly }: ActivityPanelProps) {
  const resource = useResource(type);
  const toast = useToast();
  const comments = useFetch<Comment[]>(`/api/comments${recordQuery(type, id)}`);
  const history = useFetch<HistoryEvent[]>(`/api/history${recordQuery(type, id)}`);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(defaultInternal);
  const [posting, setPosting] = useState(false);

  const post = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    try {
      await api.post('/api/comments', { record_type: type, record_id: id, body: body.trim(), internal: internalOnly || internal });
      setBody('');
      comments.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const items = [
    ...(comments.data ?? []).map((c) => ({ at: c.created_at, comment: c, event: undefined })),
    ...(history.data ?? []).map((h) => ({ at: h.at, comment: undefined, event: h })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="activity">
      <form className="activity-compose" onSubmit={post}>
        <TextArea label="Add a comment" rows={3} value={body} onChange={setBody} />
        <div className="activity-compose-row">
          {!internalOnly && (
            <Checkbox label="Internal note" hint="Internal notes are visible to staff only." checked={internal} onChange={setInternal} />
          )}
          <Button type="submit" variant="primary" icon="message" loading={posting} disabled={!body.trim()}>Add comment</Button>
        </div>
      </form>

      {comments.error ? (
        <ErrorState title="Comments could not be loaded" error={comments.error} onRetry={comments.reload} />
      ) : !comments.data ? (
        <Loading label="Loading activity" />
      ) : items.length === 0 ? (
        <EmptyState icon="message" title="No activity yet" message="Comments and changes will appear here." />
      ) : (
        <ol className="timeline">
          {items.map(({ comment, event }) => comment ? (
            <li key={`c-${comment.id}`} className="timeline-item timeline-comment">
              <div className="timeline-head">
                <strong>{comment.author_name ?? 'Unknown user'}</strong>
                <Badge color={comment.internal ? 'amber' : 'blue'}>{comment.internal ? 'Internal note' : 'Public comment'}</Badge>
                <time className="muted" dateTime={comment.created_at} title={relativeTime(comment.created_at)}>{formatDateTime(comment.created_at)}</time>
              </div>
              <p className="prose">{comment.body}</p>
            </li>
          ) : event ? (
            <HistoryEntry key={`h-${event.id}`} event={event} resource={resource} />
          ) : null)}
        </ol>
      )}
    </div>
  );
}

/* ---------- Related records ---------- */

interface RecordLink {
  id: string;
  relation: string;
  direction: 'out' | 'in';
  type: string;
  typeLabel: string;
  recordId: string;
  label: string;
  ref: string | null;
  route: string;
}

export interface LinksPanelProps extends PanelProps {
  /** Defaults to whether the user holds `<module>.edit` for this record type. */
  editable?: boolean;
}

/** Related records grouped by type, with add (record picker + relation) and remove. */
export function LinksPanel({ type, id, editable }: LinksPanelProps) {
  const { resources, lookups } = useMeta();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<RecordLink[]>(`/api/links${recordQuery(type, id)}`);
  const [toType, setToType] = useState('');
  const [toId, setToId] = useState<string | null>(null);
  const [relation, setRelation] = useState('related to');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RecordLink | null>(null);

  const resource = resources[type];
  const canEdit = editable ?? (resource ? can(`${resource.module}.edit`) : false);
  const typeOptions = Object.values(resources)
    .filter((r) => can(`${r.module}.view`))
    .map((r) => ({ value: r.type, label: r.label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!toType || !toId || !relation.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/links', { from_type: type, from_id: id, to_type: toType, to_id: toId, relation: relation.trim() });
      setToId(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/links/${removing.id}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const groups = new Map<string, RecordLink[]>();
  for (const link of data ?? []) groups.set(link.typeLabel, [...(groups.get(link.typeLabel) ?? []), link]);

  return (
    <div className="links">
      {canEdit && (
        <form className="links-add" onSubmit={add}>
          <Select label="Record type" options={typeOptions} value={toType} onChange={(v) => { setToType(v); setToId(null); }} />
          <RecordPicker key={toType} label="Record" type={toType} disabled={!toType} value={toId} onChange={setToId} />
          {lookups.link_relation
            ? <LookupSelect label="Relation" list="link_relation" value={relation} onChange={setRelation} />
            : <TextField label="Relation" value={relation} onChange={setRelation} maxLength={60} />}
          <Button type="submit" icon="link" loading={busy && !removing} disabled={!toType || !toId || !relation.trim()}>Add link</Button>
        </form>
      )}

      {error ? (
        <ErrorState title="Related records could not be loaded" error={error} onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading related records" />
      ) : data.length === 0 ? (
        <EmptyState icon="link" title="No related records" message={canEdit ? 'Link this record to others using the form above.' : undefined} />
      ) : (
        [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([typeLabel, links]) => (
          <section key={typeLabel} className="links-group">
            <h3 className="links-heading">{typeLabel} <span className="tab-count">{links.length}</span></h3>
            <ul className="links-list">
              {links.map((link) => (
                <li key={link.id}>
                  <Link to={recordHref(link.route, link.recordId)}>
                    {link.ref && <span className="ref">{link.ref}</span>}
                    {link.label}
                  </Link>
                  <span className="muted">{link.direction === 'in' ? `${link.relation} (linked from that record)` : link.relation}</span>
                  {canEdit && <IconButton icon="trash" size="sm" label={`Remove link to ${link.label}`} onClick={() => setRemoving(link)} />}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove link"
        message={`Remove the link to "${removing?.label}"? The record itself is not deleted.`}
        confirmLabel="Remove link"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/* ---------- Record page ---------- */

export interface RecordContext {
  row: Row;
  resource: ResourceMeta;
  /** Re-read the record from the server. */
  reload: () => void;
  /** PATCH the record, e.g. `save({ status: 'closed' })`. Rejects with ApiError. */
  save: (patch: Record<string, unknown>) => Promise<Row>;
  /** Whether the user holds `<module>.edit`. */
  canEdit: boolean;
}

export interface RecordTab {
  key: string;
  label: string;
  count?: number;
  content: (rec: RecordContext) => ReactNode;
}

export type DefaultTab = 'activity' | 'links' | 'history';

export interface RecordPageProps {
  /** Record type key, e.g. "ticket". */
  type: string;
  /** Record id. Defaults to the `:id` route parameter. */
  id?: string;
  /** Header title. Defaults to the resource's title field. */
  title?: (row: Row) => string;
  subtitle?: (row: Row) => ReactNode;
  /** Header chip. Defaults to the `status` field when it is a lookup. */
  status?: (row: Row) => ReactNode;
  /** Header buttons. */
  actions?: (rec: RecordContext) => ReactNode;
  /** Shown between header and summary: the place for a Stepper or Countdowns. */
  banner?: (rec: RecordContext) => ReactNode;
  /** Fields for the default summary (an EditableSummary). */
  summaryFields?: string[];
  /** Replaces the default summary entirely. */
  summary?: (rec: RecordContext) => ReactNode;
  /** Module tabs, shown before the built-in ones. */
  tabs?: RecordTab[];
  /** Built-in tabs to include (default: all three). */
  defaultTabs?: DefaultTab[];
  /** Defaults to "<Plural> / <reference or title>". */
  breadcrumbs?: Crumb[];
}

const ALL_DEFAULT_TABS: DefaultTab[] = ['activity', 'links', 'history'];

export function RecordPage({
  type, id: idProp, title, subtitle, status, actions, banner, summaryFields, summary, tabs = [],
  defaultTabs = ALL_DEFAULT_TABS, breadcrumbs,
}: RecordPageProps) {
  const params = useParams();
  const id = idProp ?? params.id ?? '';
  const resource = useResource(type);
  const { can } = useAuth();
  const { row, error, reload, save } = useRecord(type, id);
  const [search, setSearch] = useSearchParams();

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;
  if (!row) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return (
        <EmptyState
          icon="lock"
          title={`${resource.label} not found`}
          message="It may have been removed, or you may not have access to it."
          action={<Link className="btn btn-secondary" to={resource.route}>Back to {resource.plural.toLowerCase()}</Link>}
        />
      );
    }
    if (error) return <ErrorState title={`This ${resource.label.toLowerCase()} could not be loaded`} error={error} onRetry={reload} />;
    return <Loading label={`Loading ${resource.label.toLowerCase()}`} lines={8} />;
  }

  const rec: RecordContext = { row, resource, reload, save, canEdit: can(`${resource.module}.edit`) };
  const reference = resource.refField ? (row[resource.refField] as string | undefined) : undefined;
  const heading = title ? title(row) : String(row[resource.titleField] ?? resource.label);
  const statusField = resource.fields.status;
  const chip = status
    ? status(row)
    : statusField?.type === 'lookup' && statusField.list
      ? <LookupChip list={statusField.list} value={row.status as string} />
      : undefined;

  const builtIn: Record<DefaultTab, TabItem> = {
    activity: { key: 'activity', label: 'Activity', content: <ActivityPanel type={type} id={id} /> },
    links: { key: 'links', label: 'Related', content: <LinksPanel type={type} id={id} /> },
    history: { key: 'history', label: 'History', content: <HistoryPanel type={type} id={id} /> },
  };
  const allTabs: TabItem[] = [
    ...tabs.map((t) => ({ key: t.key, label: t.label, count: t.count, content: t.content(rec) })),
    ...defaultTabs.map((key) => builtIn[key]),
  ];

  return (
    <article className="record">
      <PageHeader
        title={heading}
        reference={reference}
        subtitle={subtitle?.(row)}
        status={chip}
        actions={actions?.(rec)}
        breadcrumbs={breadcrumbs ?? [{ label: resource.plural, to: resource.route }, { label: reference ?? heading }]}
      />
      {banner && <div className="record-banner">{banner(rec)}</div>}
      {summary
        ? summary(rec)
        : summaryFields && <EditableSummary type={type} row={row} fields={summaryFields} onSaved={reload} />}
      {allTabs.length > 0 && (
        <Tabs
          label={`${resource.label} sections`}
          tabs={allTabs}
          active={search.get('tab') ?? allTabs[0].key}
          onChange={(key) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true })}
        />
      )}
    </article>
  );
}
