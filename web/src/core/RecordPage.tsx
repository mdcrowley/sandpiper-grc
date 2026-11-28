// Record detail page and its ready-made panels: activity, history, related records, editable summary.
import { lazy, Suspense, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { ApiError, type Row } from './api';
import { useAuth } from './auth';
import { fieldMeta, FieldValue, knownFields } from './FieldValue';
import { relativeTime } from './format';
import { useFetch, useRecord } from './hooks';
import { customFieldNames, LookupChip, useResource, type ResourceMeta } from './meta';
import { useToast } from './overlay';
import { ActivityPanel, type RecordComment } from './RecordActivity';
import { HistoryPanel, recordQuery } from './RecordHistory';
import { LinksPanel, type RecordLink } from './RecordLinks';
import { formDraftKey, ResourceForm, type FormSection } from './ResourceForm';
import { hasDraft } from './unsaved';
import { RecordTags, WatchButton } from './tags';
import { RecordPdfButton } from './ListExport';
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
  /**
   * Also show (and edit) the record type's custom fields after `fields`. Default false, so a page with
   * several summary cards does not repeat them; RecordPage's default summary turns it on.
   */
  customFields?: boolean;
  /** Shown after a field's value, for example "From model Forty-foot bus" (E39-02). */
  annotate?: (field: string) => ReactNode;
  /** Asked before a save is sent; false keeps the form open (see ResourceForm). */
  confirmSave?: (body: Record<string, unknown>) => Promise<boolean>;
}

/** A definition list of the given fields that flips into a form. */
export function EditableSummary({ type, row, fields, onSaved, title = 'Details', editable, sections, customFields = false, annotate, confirmSave }: EditableSummaryProps) {
  const resource = useResource(type);
  const { can, user } = useAuth();
  const toast = useToast();
  // A draft kept when the session ended mid-edit opens the form again, with the draft in it (BW-02).
  const [editing, setEditing] = useState(() => hasDraft(formDraftKey(type, row.id, fields), user?.id));
  // Saved or canceled: the form and its buttons go away, so the focus goes back to Edit rather than
  // to nowhere (E16-15). The form puts the focus in its first field itself.
  const cardId = useId();
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    if (!editing) document.getElementById(cardId)?.querySelector<HTMLElement>('.card-actions button')?.focus();
  }, [editing, cardId]);
  if (!resource) return <ErrorState title={`Unknown record type "${type}"`} />;
  const canEdit = editable ?? can(`${resource.module}.edit`);
  // The record type's custom fields follow the given ones (the form adds them the same way).
  const named = knownFields(resource, fields);
  const shownFields = customFields ? [...named, ...customFieldNames(resource).filter((f) => !named.includes(f))] : named;

  return (
    <Card
      id={cardId}
      title={title}
      className="rc-summary"
      actions={canEdit && !editing && (
        <Button variant="default" size="xs" leftSection={<IconPencil size={14} aria-hidden="true" />} aria-label={`Edit ${title.toLowerCase()}`} onClick={() => setEditing(true)}>Edit</Button>
      )}
    >
      {editing ? (
        <ResourceForm
          type={type}
          id={row.id}
          fields={fields}
          sections={sections}
          customFields={customFields}
          confirmSave={confirmSave}
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
          {shownFields.map((field) => {
            const meta = fieldMeta(resource, field);
            // Long text gets the full width only when there is enough of it to need the room.
            const text = meta.type === 'longtext' ? String(row[field] ?? '') : '';
            const wide = meta.type === 'json' ? row[field] != null : text.length > 70 || text.includes('\n');
            return (
              <div key={field} className={`rc-def${wide ? ' rc-def-wide' : ''}`}>
                <dt>{meta.label}</dt>
                <dd><FieldValue resource={resource} field={field} row={row} />{annotate?.(field)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </Card>
  );
}

/**
 * A record type's custom fields as an editable card ("More details"). RecordPage adds it under a
 * module's own summary; with `summaryFields` they are part of the default summary instead.
 * Renders nothing when the type has no custom fields.
 */
export function CustomFieldsCard({ type, row, onSaved, title = 'More details' }: { type: string; row: Row; onSaved?: (row: Row) => void; title?: string }) {
  const resource = useResource(type);
  const names = customFieldNames(resource);
  if (!resource || names.length === 0) return null;
  return <EditableSummary type={type} row={row} fields={[]} customFields onSaved={onSaved} title={title} />;
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
const attachmentLoaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean; onChange?: () => void }> }>(
  '../modules/attachments/AttachmentsPanel.tsx',
);
const loadAttachments = Object.values(attachmentLoaders)[0];
const AttachmentsPanel = loadAttachments ? lazy(() => loadAttachments().then((m) => ({ default: m.AttachmentsPanel }))) : null;

// The workflows module supplies the approval panel (E14-06) the same way: shown under the header
// when an approval workflow has run on the record or may be started; it draws nothing otherwise.
const workflowLoaders = import.meta.glob<{ WorkflowPanel: ComponentType<{ recordType: string; recordId: string; version?: string; onChange?: () => void }> }>(
  '../modules/workflows/WorkflowPanel.tsx',
);
const loadWorkflows = Object.values(workflowLoaders)[0];
const WorkflowPanel = loadWorkflows ? lazy(() => loadWorkflows().then((m) => ({ default: m.WorkflowPanel }))) : null;
// The evidence library (E45-08) supplies an Evidence tab for every record type it links to, the same
// way: shown while the evidence area is on and the reader holds evidence.view, unless the module has a
// tab of its own called "evidence". The list mirrors LINK_TYPES in server/src/modules/evidence/links.ts;
// the server decides who may link and counts what the reader may not see.
const evidenceLoaders = import.meta.glob<{ EvidencePanel: ComponentType<{ recordType: string; recordId: string }> }>(
  '../modules/evidence/EvidencePanel.tsx',
);
const loadEvidence = Object.values(evidenceLoaders)[0];
const EvidencePanel = loadEvidence ? lazy(() => loadEvidence().then((m) => ({ default: m.EvidencePanel }))) : null;
const EVIDENCE_TYPES = new Set([
  'control', 'control_test', 'obligation', 'audit_engagement', 'audit_request', 'audit_finding', 'cap', 'action',
  'framework_outcome', 'policy', 'risk', 'evidence_item', 'funding_award', 'funding_certification',
  'procurement', 'purchase_order', 'insurance_policy', 'insurance_certificate', 'insurance_condition',
]);
// Legal holds (E34): a banner on a held record, for people who may see holds (the server sends `_holds`).
const holdLoaders = import.meta.glob<{ HoldBanner: ComponentType<{ row: Row }> }>('../modules/holds/HoldBanner.tsx');
const loadHolds = Object.values(holdLoaders)[0];
const HoldBanner = loadHolds ? lazy(() => loadHolds().then((m) => ({ default: m.HoldBanner }))) : null;

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
  /**
   * Header buttons. They are drawn in one order on every record page: a primary button (core
   * `Button variant="primary"`) first, then the others as given, then PDF and Watch, and an icon-only
   * "⋯" `Menu` last, wherever it is given.
   */
  actions?: (rec: RecordContext) => ReactNode;
  /** Shown between header and summary: the place for a Stepper or Countdowns. */
  banner?: (rec: RecordContext) => ReactNode;
  /** Fields for the default summary (an EditableSummary). */
  summaryFields?: string[];
  /** Shown after a field's value in the default summary (E39-02: where an inherited value comes from). */
  annotate?: (row: Row, field: string) => ReactNode;
  /** Asked before the default summary's form saves; false keeps it open (E39-03). */
  confirmSave?: (row: Row, body: Record<string, unknown>) => Promise<boolean>;
  /** Replaces the default summary entirely. */
  summary?: (rec: RecordContext) => ReactNode;
  /** Module tabs, shown before the built-in ones. */
  tabs?: RecordTab[];
  /** Built-in tabs to include (default: all three). */
  defaultTabs?: DefaultTab[];
  /** Defaults to "<Plural> / <reference or title>". */
  breadcrumbs?: Crumb[];
  /** Show the record's tags under the header, editable by people who may edit it. Default true. */
  tags?: boolean;
  /** Show a Watch button among the header buttons. Default true. */
  watch?: boolean;
  /**
   * Files on this record are evidence: the built-in tab is called "Evidence files" and records new
   * files as evidence, with a collection date and an optional expiry date. Default: the record type's
   * `evidence` flag in /api/meta (true for evidence-bearing types such as policies and risks).
   */
  evidence?: boolean;
}

const ALL_DEFAULT_TABS: DefaultTab[] = ['activity', 'attachments', 'links', 'history'];

export function RecordPage({
  type, id: idProp, title, subtitle, status, actions, banner, summaryFields, summary, tabs = [],
  defaultTabs = ALL_DEFAULT_TABS, breadcrumbs, tags = true, watch = true, evidence: evidenceProp, annotate, confirmSave,
}: RecordPageProps) {
  const params = useParams();
  const id = idProp ?? params.id ?? '';
  const resource = useResource(type);
  const { can, areaOn } = useAuth();
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
  // The panel loads its own list; refresh the count when the user moves between tabs, and
  // whenever a panel for this record says its files changed (upload, removal).
  useEffect(() => {
    if (activeTab !== null) reloadFiles();
  }, [activeTab, reloadFiles]);
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ recordType?: string; recordId?: string }>).detail;
      if (detail?.recordType === type && detail.recordId === id) reloadFiles();
    };
    window.addEventListener('grc:attachments-changed', onChanged);
    return () => window.removeEventListener('grc:attachments-changed', onChanged);
  }, [type, id, reloadFiles]);
  // A panel that changes the record itself (the Tags panel sets its Tag number) asks for the summary to reload.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ recordType?: string; recordId?: string }>).detail;
      if (detail?.recordType === type && detail.recordId === id) reload();
    };
    window.addEventListener('grc:record-changed', onChanged);
    return () => window.removeEventListener('grc:record-changed', onChanged);
  }, [type, id, reload]);
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

  const evidence = evidenceProp ?? Boolean(resource.evidence);
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
      key: 'attachments', label: evidence ? 'Evidence files' : 'Attachments', count: files.data?.rows?.length || undefined,
      content: AttachmentsPanel && (
        <Suspense fallback={<Loading label="Loading files" lines={3} />}>
          <AttachmentsPanel recordType={type} recordId={id} evidence={evidence} />
        </Suspense>
      ),
    },
    links: {
      key: 'links', label: 'Related', count: links.data?.length || undefined,
      content: <LinksPanel type={type} id={id} linksState={links} />,
    },
    history: { key: 'history', label: 'History', content: <HistoryPanel type={type} id={id} row={row} /> },
  };
  const evidenceTab: TabItem[] = EvidencePanel && EVIDENCE_TYPES.has(type) && areaOn('evidence') && can('evidence.view')
    && !tabs.some((t) => t.key === 'evidence')
    ? [{
      key: 'evidence', label: 'Evidence',
      content: <Suspense fallback={<Loading label="Loading evidence" lines={3} />}><EvidencePanel recordType={type} recordId={id} /></Suspense>,
    }]
    : [];
  const shownDefaults = defaultTabs.filter((key) => key !== 'attachments' || (wantsFiles && !filesMissing)).map((key) => builtIn[key]);
  const filesAt = shownDefaults.findIndex((t) => t.key === 'attachments');
  const allTabs: TabItem[] = [
    ...tabs.map((t) => ({ key: t.key, label: t.label, count: t.count, content: t.content(rec) })),
    // The Evidence tab comes just before the files (or before Related when there is no files tab).
    ...(filesAt >= 0 ? [...shownDefaults.slice(0, filesAt), ...evidenceTab, ...shownDefaults.slice(filesAt)] : [...shownDefaults.slice(0, 1), ...evidenceTab, ...shownDefaults.slice(1)]),
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
        actions={<>{actions?.(rec)}<RecordPdfButton resource={resource} id={id} label={reference ?? heading} />{watch && <WatchButton recordType={type} recordId={id} />}</>}
        breadcrumbs={breadcrumbs ?? [{ label: resource.plural, to: resource.route }, { label: reference ?? heading }]}
        primaryFirst
      />
      {tags && <RecordTags recordType={type} recordId={id} canEdit={rec.canEdit} />}
      {HoldBanner && Array.isArray(row._holds) && row._holds.length > 0 && <Suspense fallback={null}><HoldBanner row={row} /></Suspense>}
      {WorkflowPanel && <Suspense fallback={null}><WorkflowPanel recordType={type} recordId={id} version={String(row.updated_at ?? '')} onChange={reload} /></Suspense>}
      {banner && <div className="rc-record-banner">{banner(rec)}</div>}
      {summary
        ? <>{summary(rec)}<CustomFieldsCard type={type} row={row} onSaved={reload} /></>
        : summaryFields && (
          <EditableSummary
            type={type} row={row} fields={summaryFields} onSaved={reload} customFields
            annotate={annotate ? (field) => annotate(row, field) : undefined}
            confirmSave={confirmSave ? (body) => confirmSave(row, body) : undefined}
          />
        )}
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
