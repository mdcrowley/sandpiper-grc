// The reading page of a document (E43-12), open to everyone it is distributed to: the text in force
// (or an earlier version, clearly marked), its dates, details, versions and relationships. A person
// outside the distribution gets "not found", exactly as for a document that does not exist.
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError, Badge, Card, DefinitionList, EmptyState, ErrorState, formatDate, Loading, NotFound, Notice, PageHeader, Select, StatusChip, Tabs, qs,
  useAuth, useFetch,
} from '../../../core';
import { PolicyBody } from '../shared';
import { DocVersionChip, HierarchyPanel, RelationshipsPanel, VersionFacts, VersionTable, versionName } from './parts';
import { docNumber, readerPath, recordPath, type ReaderView } from './types';

const BANNER_TONE = { superseded: 'warning', obsolete: 'warning', reference: 'info', scheduled: 'info' } as const;

/** Print (the controlled-copy PDF) and, for editors, the original file. */
function FileLinks({ view }: { view: ReaderView }) {
  const v = view.version;
  if (!v) return null;
  const base = `/api/policies/${view.document.id}/versions/${v.id}`;
  return (
    <span className="row doc-file-links">
      <a className="btn btn-secondary btn-sm" href={`${base}/pdf`} target="_blank" rel="noopener">Print or save as PDF</a>
      {view.document.can_edit && v.source_attachment_id && <a className="btn btn-ghost btn-sm" href={`${base}/original`}>Download the original</a>}
    </span>
  );
}

function ReadTab({ view, pick }: { view: ReaderView; pick: (version: number | null) => void }) {
  const v = view.version;
  if (!v) {
    return <Card><EmptyState icon="file-text" title="Nothing to read yet" message="This document has no effective version." /></Card>;
  }
  const switcher = view.versions.length > 1 && (
    <span className="row pol-switch">
      <DocVersionChip v={v} />
      <Select
        label="Version to read" hideLabel size="xs" value={String(v.version)}
        onChange={(n) => pick(n ? Number(n) : null)}
        options={view.versions.map((x) => ({ value: String(x.version), label: `${versionName(x)}${x.status === 'published' ? ' (in force)' : ''}` }))}
      />
    </span>
  );
  return (
    <Card title={v.status === 'published' ? 'Text in force' : versionName(v)} actions={switcher || <DocVersionChip v={v} />}>
      <VersionFacts v={v} />
      <FileLinks view={view} />
      {v.content_kind === 'file' ? (
        <div className="doc-filever">
          <p>This version is kept as a file. Open the controlled copy to read it.</p>
          <a className="btn btn-primary" href={`/api/policies/${view.document.id}/versions/${v.id}/pdf`} target="_blank" rel="noopener">Open the document</a>
          {v.body_html ? <div className="pol-page-body"><PolicyBody html={v.body_html} empty="" /></div> : null}
        </div>
      ) : (
        <div className={v.status === 'published' ? 'pol-page-body' : 'pol-page-body doc-old-text'}><PolicyBody html={v.body_html} /></div>
      )}
    </Card>
  );
}

function DetailsTab({ view }: { view: ReaderView }) {
  const d = view.document;
  const external = d.document_type === 'external' || Boolean(d.publisher || d.edition);
  return (
    <Card title="About this document">
      <DefinitionList items={[
        { label: 'Number', value: docNumber(d) },
        { label: 'Type', value: d.type_label ?? d.document_type },
        { label: 'Owner', value: d.owner_name },
        { label: 'Owning department', value: d.department_name },
        { label: 'Approver', value: [d.approver_name, d.approver_role].filter(Boolean).join(', ') },
        { label: 'Readers', value: d.access === 'restricted' ? 'Restricted distribution' : 'Everyone in the organization' },
        ...(d.uncontrolled ? [] : [
          { label: 'Next review', value: d.next_review_on ? formatDate(d.next_review_on) : '' },
          { label: 'Last reviewed', value: d.last_reviewed_on ? formatDate(d.last_reviewed_on) : '' },
        ]),
        ...(d.expires_on ? [{ label: 'Expires', value: formatDate(d.expires_on) }] : []),
        ...(external ? [
          { label: 'Publisher', value: d.publisher },
          { label: 'Edition', value: d.edition },
          { label: 'Published', value: d.published_on ? formatDate(d.published_on) : '' },
          { label: 'Source', value: d.source_url ? <a href={d.source_url} target="_blank" rel="noopener noreferrer">{d.source_url}</a> : '' },
          { label: 'License', value: d.license_note, wide: true },
        ] : []),
        ...(d.retired_on ? [
          { label: 'Made obsolete', value: formatDate(d.retired_on) },
          { label: 'Reason', value: d.retire_reason, wide: true },
          { label: 'Replaced by', value: d.replaced_by ? <Link to={readerPath(d.replaced_by.id)}>{docNumber(d.replaced_by)} {d.replaced_by.title}</Link> : '' },
        ] : []),
        { label: 'Summary', value: d.summary, wide: true },
      ]} />
    </Card>
  );
}

export function DocumentReader() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const version = params.get('version');
  const tab = params.get('tab') ?? 'read';
  const { data, error, reload } = useFetch<ReaderView>(`/api/documents/library/${id}${qs({ version })}`, { keepPrevious: true });

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  const crumbs = [{ label: 'Document library', to: '/documents' }];
  if (error) {
    if (error instanceof ApiError && error.status === 404) return <NotFound />;
    return <><PageHeader title="Document" breadcrumbs={crumbs} /><ErrorState error={error} onRetry={reload} /></>;
  }
  if (!data) return <><PageHeader title="Document" breadcrumbs={crumbs} /><Loading lines={10} label="Loading the document" /></>;

  const d = data.document;
  const obsolete = d.status === 'retired' || Boolean(d.retired_on);
  const tabs = [
    { key: 'read', label: 'Read' },
    { key: 'details', label: 'Details' },
    { key: 'versions', label: 'Versions', count: data.versions.length || undefined },
    { key: 'related', label: 'Relationships' },
  ];

  return (
    <div className="stack">
      <PageHeader
        title={d.title} reference={docNumber(d) || undefined}
        breadcrumbs={[...crumbs, { label: docNumber(d) || d.title }]}
        status={(
          <span className="row doc-head-chips">
            {obsolete ? <StatusChip color="purple" label="Obsolete" /> : d.uncontrolled ? <StatusChip color="gray" label="Reference only" /> : <StatusChip color="green" label="Effective" />}
            {d.access === 'restricted' && <Badge color="amber">Restricted distribution</Badge>}
          </span>
        )}
        subtitle={(
          <span className="row doc-head-facts">
            <span>{d.type_label ?? d.document_type}</span>
            {d.owner_name && <span>Owner: {d.owner_name}</span>}
            {!d.uncontrolled && !obsolete && d.next_review_on && <span>Next review: {formatDate(d.next_review_on)}</span>}
          </span>
        )}
        actions={(d.can_edit || can('policies.view')) ? <Link className="btn btn-secondary" to={recordPath(d.id)}>Open in the register</Link> : undefined}
      />
      {data.banner && (
        <Notice tone={BANNER_TONE[data.banner.kind]}>
          {data.banner.text}
          {data.banner.kind === 'superseded' && version && (
            <> <button type="button" className="pol-linkbtn" onClick={() => go({ version: null })}>Read the version in force</button></>
          )}
        </Notice>
      )}
      <Tabs label="Document" active={tab} tabs={tabs} onChange={(k) => go({ tab: k === 'read' ? null : k })} />
      {tab === 'read' && <ReadTab view={data} pick={(n) => go({ version: n ? String(n) : null })} />}
      {tab === 'details' && <DetailsTab view={data} />}
      {tab === 'versions' && (
        <Card title="Versions" flush>
          <VersionTable
            versions={data.versions} caption="Every issued version of this document, newest first"
            onRead={(v) => go({ version: String(v.version), tab: null })}
          />
        </Card>
      )}
      {tab === 'related' && (
        <div className="stack">
          <HierarchyPanel id={d.id} />
          <RelationshipsPanel id={d.id} />
        </div>
      )}
    </div>
  );
}
