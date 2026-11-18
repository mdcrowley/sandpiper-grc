// Record detail page and its ready-made panels: activity, history, related records, editable summary.
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { ApiError, type Row } from './api';
import { useAuth } from './auth';
import { fieldMeta, FieldValue } from './FieldValue';
import { relativeTime } from './format';
import { useFetch, useRecord } from './hooks';
import { LookupChip, useResource, type ResourceMeta } from './meta';
import { useToast } from './overlay';
import { ActivityPanel, type RecordComment } from './RecordActivity';
import { HistoryPanel, recordQuery } from './RecordHistory';
import { LinksPanel, type RecordLink } from './RecordLinks';
import { ResourceForm, type FormSection } from './ResourceForm';
import { Card, EmptyState, ErrorState, Loading, PageHeader, Tabs, type Crumb, type TabItem } from './ui';
import './records.css';

export { ActivityPanel, type ActivityPanelProps } from './RecordActivity';
export { HistoryPanel, type HistoryPanelProps, type PanelProps } from './RecordHistory';
export { LinksPanel, type LinksPanelProps } from './RecordLinks';

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
  /** Headings for groups of fields while editing (see ResourceForm). */
  sections?: FormSection[];
}

/** A definition list of the given fields that flips into a form. */
export function EditableSummary({ type, row, fields, onSaved, title = 'Details', editable, sections }: EditableSummaryProps) {
  const resource = useResource(type);
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;
  const canEdit = editable ?? can(`${resource.module}.edit`);

  return (
    <Card
      title={title}
      className="rc-summary"
      actions={canEdit && !editing && (
        <Button variant="default" size="xs" leftSection={<IconPencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>Edit</Button>
      )}
    >
      {editing ? (
        <ResourceForm
          type={type}
          id={row.id}
          fields={fields}
          sections={sections}
          initial={row}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            toast.success('Changes saved.');
            onSaved?.(saved);
          }}
        />
      ) : (
        <dl className="rc-deflist">
          {fields.map((field) => {
            const meta = fieldMeta(resource, field);
            // Long text gets the full width only when there is enough of it to need the room.
            const text = meta.type === 'longtext' ? String(row[field] ?? '') : '';
            const wide = meta.type === 'json' ? row[field] != null : text.length > 70 || text.includes('\n');
            return (
              <div key={field} className={`rc-def${wide ? ' rc-def-wide' : ''}`}>
                <dt>{meta.label}</dt>
                <dd><FieldValue resource={resource} field={field} row={row} /></dd>
              </div>
            );
          })}
        </dl>
      )}
    </Card>
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

export type DefaultTab = 'activity' | 'attachments' | 'links' | 'history';

// The attachments module supplies the panel. It is found at build time and loaded on first use,
// so the core starts without it and still builds when the module folder is absent.
const attachmentLoaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../modules/attachments/AttachmentsPanel.tsx',
);
const loadAttachments = Object.values(attachmentLoaders)[0];
const AttachmentsPanel = loadAttachments ? lazy(() => loadAttachments().then((m) => ({ default: m.AttachmentsPanel }))) : null;

export interface RecordPageProps {
  /** Record type key, e.g. "ticket". */
  type: string;
  /** Record id. Defaults to the `:id` route parameter. */
  id?: string;
  /** Header title. Defaults to the resource's title field. */
  title?: (row: Row) => string;
  /** Line under the title. Default: who last changed the record and when. */
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

const ALL_DEFAULT_TABS: DefaultTab[] = ['activity', 'attachments', 'links', 'history'];

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
  // Loaded here so the tabs can show counts; the panels reuse these requests.
  const ready = Boolean(resource && row);
  const comments = useFetch<RecordComment[]>(ready && defaultTabs.includes('activity') ? `/api/comments${recordQuery(type, id)}` : null);
  const links = useFetch<RecordLink[]>(ready && defaultTabs.includes('links') ? `/api/links${recordQuery(type, id)}` : null);
  // A module tab of its own called "attachments" or "files" replaces the built-in one.
  const wantsFiles = Boolean(AttachmentsPanel) && defaultTabs.includes('attachments') && !tabs.some((t) => ['attachments', 'files'].includes(t.key));
  const files = useFetch<{ rows: unknown[] }>(ready && wantsFiles ? `/api/attachments${recordQuery(type, id)}` : null);
  const activeTab = search.get('tab');
  const reloadFiles = files.reload;
  // The panel loads its own list; refresh the count when the user moves between tabs.
  useEffect(() => {
    if (activeTab !== null) reloadFiles();
  }, [activeTab, reloadFiles]);
  // No attachments service on this server (module not loaded): leave the tab out.
  const filesMissing = files.error instanceof ApiError && files.error.status === 404;

  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;
  if (!row) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return (
        <EmptyState
          icon="lock"
          title={`${resource.label} not found`}
          message="It may have been removed, or you may not have access to it."
          action={<Button component={Link} variant="default" to={resource.route}>Back to {resource.plural.toLowerCase()}</Button>}
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
  const updatedBy = row._display?.updated_by;
  const defaultSubtitle = row.updated_at
    ? <span title={String(row.updated_at)}>Updated {relativeTime(row.updated_at as string)}{updatedBy ? ` by ${updatedBy}` : ''}</span>
    : undefined;

  const builtIn: Record<DefaultTab, TabItem> = {
    activity: {
      key: 'activity', label: 'Activity', count: comments.data?.length || undefined,
      content: <ActivityPanel type={type} id={id} row={row} commentsState={comments} />,
    },
    attachments: {
      key: 'attachments', label: 'Attachments', count: files.data?.rows?.length || undefined,
      content: AttachmentsPanel && (
        <Suspense fallback={<Loading label="Loading files" lines={3} />}>
          <AttachmentsPanel recordType={type} recordId={id} />
        </Suspense>
      ),
    },
    links: {
      key: 'links', label: 'Related', count: links.data?.length || undefined,
      content: <LinksPanel type={type} id={id} linksState={links} />,
    },
    history: { key: 'history', label: 'History', content: <HistoryPanel type={type} id={id} row={row} /> },
  };
  const allTabs: TabItem[] = [
    ...tabs.map((t) => ({ key: t.key, label: t.label, count: t.count, content: t.content(rec) })),
    ...defaultTabs.filter((key) => key !== 'attachments' || (wantsFiles && !filesMissing)).map((key) => builtIn[key]),
  ];
  const wanted = search.get('tab');
  const active = allTabs.some((t) => t.key === wanted) ? (wanted as string) : allTabs[0]?.key;

  return (
    <article className="rc-record">
      <PageHeader
        title={heading}
        reference={reference}
        subtitle={subtitle ? subtitle(row) : defaultSubtitle}
        status={chip}
        actions={actions?.(rec)}
        breadcrumbs={breadcrumbs ?? [{ label: resource.plural, to: resource.route }, { label: reference ?? heading }]}
      />
      {banner && <div className="rc-record-banner">{banner(rec)}</div>}
      {summary
        ? summary(rec)
        : summaryFields && <EditableSummary type={type} row={row} fields={summaryFields} onSaved={reload} />}
      {allTabs.length > 0 && (
        <div className="rc-record-tabs">
          <Tabs
            label={`${resource.label} sections`}
            tabs={allTabs}
            active={active}
            onChange={(key) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true })}
          />
        </div>
      )}
    </article>
  );
}
