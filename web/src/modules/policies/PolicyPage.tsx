// The record page of a document, for the people who keep the register: the text with its dates, the
// details, who can read it and who must acknowledge it, then versions, the hierarchy and links,
// acknowledgments, translations, reviews, mapped outcomes and exceptions behind tabs. Readers without
// a role in documents read the same document on its library page (/documents/:id).
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Card, EditableSummary, EmptyState, ErrorState, Loading, RecordPage, ResourceList, Select, useAuth, useFetch, useResource,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { AckTracking } from './AckTracking';
import { AudienceCard } from './AudienceCard';
import { OutcomesPanel } from './OutcomesPanel';
import { PolicyActions } from './PolicyActions';
import { ExpiryChip, PolicyBody, ReviewChip } from './shared';
import { TranslationsPanel } from './TranslationsPanel';
import { VersionsPanel } from './VersionsPanel';
import { AccessCard } from './documents/AccessEditor';
import { DocVersionChip, HierarchyPanel, RelationshipsPanel, VersionFacts, versionDates, versionName } from './documents/parts';
import { ReviewsPanel } from './documents/Reviews';
import { readerPath, recordPath, type FullVersion } from './documents/types';

// The plan panel (E28, GOVERNANCE): the element map and annual review of a policy whose document type
// is a plan. Loaded only when its file is in the build; it shows nothing for other policies.
type PlanPanelProps = { policy: Row; onChanged?: () => void };
const planLoaders = import.meta.glob<{ PlanPanel: ComponentType<PlanPanelProps> }>('./PlanPanel.tsx');
const loadPlan = Object.values(planLoaders)[0];
const PlanPanel = loadPlan ? lazy(() => loadPlan().then((m) => ({ default: m.PlanPanel }))) : null;

// The controls covering a policy (E26-11), from the control library when it is part of the build. The
// panel renders nothing while the controls area is off or without controls.view.
const controlsLoaders = import.meta.glob<{ ControlsPanel: ComponentType<{ recordType: string; recordId: string }> }>('../controls/ControlsPanel.tsx');
const loadControls = Object.values(controlsLoaders)[0];
const ControlsPanel = loadControls ? lazy(() => loadControls().then((m) => ({ default: m.ControlsPanel }))) : null;

interface VersionsState { data: FullVersion[] | undefined; error: unknown; reload: () => void }

/** The text: the version in force, or for the people writing it, the newest version so far. */
function Reader({ row, versions }: { row: Row; versions: VersionsState }) {
  const { can } = useAuth();
  const [chosen, setChosen] = useState('');
  if (versions.error) return <Card title="Text"><ErrorState error={versions.error} onRetry={versions.reload} /></Card>;
  if (!versions.data) return <Card title="Text"><Loading lines={8} label="Loading the text" /></Card>;
  const published = versions.data.find((v) => v.status === 'published');
  const shown = versions.data.find((v) => v.id === chosen) ?? published ?? versions.data[0];
  if (!shown) {
    const write = can('policies.edit') && row.status !== 'retired';
    return (
      <Card title="Text">
        <EmptyState
          icon="file-text" title={write ? 'No text yet' : 'Not published yet'}
          message={write ? 'Write the first version, or upload it from Word or a PDF; have it approved, then publish it.' : 'This document has no published version to read yet.'}
          action={write ? (
            <span className="row">
              <Link className="btn btn-primary" to={`${recordPath(row.id)}/edit`}>Write the first version</Link>
              <Link className="btn btn-secondary" to={`${recordPath(row.id)}/upload`}>Upload a file</Link>
            </span>
          ) : undefined}
        />
      </Card>
    );
  }
  const switcher = versions.data.length > 1 && (
    <span className="row pol-switch">
      <DocVersionChip v={shown} />
      <Select label="Version to read" hideLabel size="xs" value={shown.id} onChange={(id) => setChosen(id || '')}
        options={versions.data.map((v) => ({ value: v.id, label: `${versionName(v)}${v.status === 'published' ? ' (in force)' : ''}` }))} />
    </span>
  );
  const heading = shown.status === 'published' ? `Text in force: ${versionName(shown)}` : versionName(shown);
  const pdf = `/api/policies/${row.id}/versions/${shown.id}/pdf`;
  return (
    <Card title={heading} actions={switcher || <DocVersionChip v={shown} />}>
      {(shown.status === 'superseded' || shown.status === 'withdrawn') && (
        <p className="notice notice-warn pol-old">
          {shown.status === 'superseded' ? `Superseded: not for use. ${versionDates(shown)}.` : `Withdrawn: not for use. ${versionDates(shown)}.`}
          {published && <>{' '}<button type="button" className="pol-linkbtn" onClick={() => setChosen(published.id)}>Read {versionName(published)}</button></>}
        </p>
      )}
      <VersionFacts v={shown} />
      <span className="row doc-file-links">
        <a className="btn btn-secondary btn-sm" href={pdf} target="_blank" rel="noopener">Print or save as PDF</a>
        {shown.source_attachment_id && can('policies.edit') && <a className="btn btn-ghost btn-sm" href={`/api/policies/${row.id}/versions/${shown.id}/original`}>Download the original</a>}
      </span>
      {shown.content_kind === 'file'
        ? <p className="muted">This version is kept as a file. <a href={pdf} target="_blank" rel="noopener">Open the controlled copy</a> to read it.</p>
        : <div className="pol-page-body"><PolicyBody html={shown.body_html} /></div>}
    </Card>
  );
}

/** Says so when a newer version is on its way, or when the document is obsolete. */
function Banner({ row, versions }: { row: Row; versions: FullVersion[] | undefined }) {
  if (row.status === 'retired') {
    return (
      <div className="pol-notice" role="status">
        <p><strong>This document is obsolete.</strong> Its text and history are kept for reference; it is not in the library and nobody is asked to acknowledge it.</p>
      </div>
    );
  }
  const latest = versions?.[0];
  const published = versions?.find((v) => v.status === 'published');
  if (!latest || latest.id === published?.id) return null;
  if (latest.status === 'approved' && latest.scheduled) {
    return (
      <div className="pol-notice pol-notice-info" role="status">
        <p><strong>{versionName(latest)} is {versionDates(latest).toLowerCase()}.</strong> {published ? `${versionName(published)} stays in force until then.` : ''}</p>
      </div>
    );
  }
  if (!published) return null;
  return (
    <div className="pol-notice pol-notice-info" role="status">
      <p>
        <strong>{versionName(latest)} is {latest.status === 'draft' ? 'a draft' : latest.status === 'in_review' ? 'in review' : 'approved'}.</strong>{' '}
        Readers still see {versionName(published)} until the new one is approved and published.
      </p>
      <Link className="btn btn-secondary btn-sm" to="?tab=versions">Compare versions</Link>
    </div>
  );
}

function PolicyExceptions({ row }: { row: Row }) {
  const { can } = useAuth();
  const exceptions = useResource('policy_exception');
  if (!exceptions || !can('exceptions.view')) {
    return <Card><EmptyState icon="lock" title="Exceptions are not available" message="Your role cannot see the exceptions register." /></Card>;
  }
  return (
    <Card flush>
      <ResourceList
        type="policy_exception"
        baseFilter={{ policy_id: row.id }}
        columns={['ref', 'title', 'status', 'approver_name', { field: 'expires_on', label: 'Expiry', sortable: true, render: (r) => <ExpiryChip date={r.expires_on} status={r.status} /> }]}
        createFields={['title', 'description', 'justification', 'compensating_controls', 'expires_on']}
        createInitial={{ policy_id: row.id }}
      />
    </Card>
  );
}

const EXTERNAL_FIELDS = ['publisher', 'edition', 'published_on', 'source_url', 'license_note', 'framework_id'];

function Summary({ rec, versions }: { rec: RecordContext; versions: VersionsState }) {
  const { row } = rec;
  const { can } = useAuth();
  const external = row.document_type === 'external';
  const fields = [
    'title', 'doc_number', 'document_type', 'summary', 'parent_id', 'owning_department_id', 'owner_id', 'approver_name', 'approver_role',
    'review_months', 'review_date', 'last_reviewed_on', 'ack_required', 'category',
    ...(external ? EXTERNAL_FIELDS : []),
    ...(row.document_type === 'bulletin' || row.expires_on ? ['expires_on'] : []),
    ...(row.status === 'retired' ? ['retired_on', 'retire_reason', 'replaced_by_id'] : []),
  ];
  return (
    <div className="stack">
      <div className="pol-layout">
        <Reader row={row} versions={versions} />
        <div className="stack">
          <EditableSummary type="policy" row={row} onSaved={rec.reload} fields={fields} />
          {/* Who may read it: the lists are for people who write documents (GET .../access needs policies.edit). */}
          {can('policies.edit') && <AccessCard row={row} onChanged={rec.reload} />}
          {row.ack_required !== false ? <AudienceCard rec={rec} /> : (
            <Card title="Who must acknowledge"><p className="muted">Readers are not asked to acknowledge this document. Turn on "Readers must acknowledge" above to ask them.</p></Card>
          )}
          {ControlsPanel && <Suspense fallback={null}><ControlsPanel recordType="policy" recordId={row.id} /></Suspense>}
        </div>
      </div>
      {/* A plan's element map and reviews take the full width under the text (E28-08, E28-09). */}
      {PlanPanel && <Suspense fallback={null}><PlanPanel policy={row} onChanged={rec.reload} /></Suspense>}
    </div>
  );
}

export function PolicyDetail() {
  const { id } = useParams();
  const fetched = useFetch<FullVersion[]>(id ? `/api/policies/${id}/versions` : null);
  const versions: VersionsState = { data: fetched.data ?? undefined, error: fetched.error, reload: fetched.reload };
  const list = versions.data ?? [];

  return (
    <RecordPage
      type="policy"
      subtitle={(row) => (
        <span className="row">
          {row.doc_number && <strong className="doc-number">{row.doc_number}</strong>}
          {row._display?.document_type && <span>{row._display.document_type}</span>}
          {row.status !== 'retired' && <><span>Next review:</span><ReviewChip date={row.review_date} status={row.status} /></>}
          {row._display?.owner_id && <span>Owner: {row._display.owner_id}</span>}
          {row.access === 'restricted' && <Badge color="amber">Restricted distribution</Badge>}
          {row.status === 'published' && <Link to={readerPath(row.id)}>Open in the library</Link>}
        </span>
      )}
      actions={(rec) => <PolicyActions rec={rec} versions={versions.data} onChanged={() => { rec.reload(); versions.reload(); }} />}
      banner={({ row }) => <Banner row={row} versions={versions.data} />}
      summary={() => null}
      tabs={[
        { key: 'policy', label: 'Document', content: (rec) => <Summary rec={rec} versions={versions} /> },
        { key: 'versions', label: 'Versions', count: list.length || undefined, content: () => (versions.data ? <VersionsPanel versions={versions.data} /> : <Card><Loading /></Card>) },
        {
          key: 'related', label: 'Hierarchy and links',
          content: ({ row }) => <div className="stack"><HierarchyPanel id={row.id} to={recordPath} /><RelationshipsPanel id={row.id} /></div>,
        },
        { key: 'acknowledgements', label: 'Acknowledgments', content: ({ row }) => (versions.data ? <AckTracking row={row} versions={versions.data} /> : <Card><Loading /></Card>) },
        { key: 'translations', label: 'Translations', content: ({ row }) => (versions.data ? <TranslationsPanel row={row} versions={versions.data} /> : <Card><Loading /></Card>) },
        { key: 'reviews', label: 'Reviews', content: (rec) => <ReviewsPanel doc={{ ...rec.row, title: String(rec.row.title) }} onChanged={rec.reload} /> },
        { key: 'outcomes', label: 'Mapped outcomes', content: ({ row }) => <OutcomesPanel row={row} /> },
        { key: 'exceptions', label: 'Exceptions', content: ({ row }) => <PolicyExceptions row={row} /> },
      ]}
    />
  );
}

