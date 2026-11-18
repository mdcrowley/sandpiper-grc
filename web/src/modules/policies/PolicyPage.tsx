// The policy page: the published text for reading, with versions, acknowledgement tracking,
// mapped outcomes and exceptions behind tabs.
import { Link, useParams } from 'react-router-dom';
import {
  Card, EditableSummary, EmptyState, ErrorState, Loading, RecordPage, ResourceList, useAuth, useFetch, useResource,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { AckTracking } from './AckTracking';
import { AudienceCard } from './AudienceCard';
import { OutcomesPanel } from './OutcomesPanel';
import { PolicyActions } from './PolicyActions';
import { ExpiryChip, PolicyBody, ReviewChip, VERSION_STATUS, VersionChip, type PolicyVersion } from './shared';
import { VersionMeta, VersionsPanel } from './VersionsPanel';

interface VersionsState { data: PolicyVersion[] | undefined; error: unknown; reload: () => void }

/** The text readers see: the published version, or for the people writing it, the newest version so far. */
function Reader({ row, versions }: { row: Row; versions: VersionsState }) {
  const { can } = useAuth();
  if (versions.error) return <Card title="Policy text"><ErrorState error={versions.error} onRetry={versions.reload} /></Card>;
  if (!versions.data) return <Card title="Policy text"><Loading lines={8} label="Loading the policy text" /></Card>;
  const published = versions.data.find((v) => v.status === 'published');
  const shown = published ?? versions.data[0];
  if (!shown) {
    return (
      <Card title="Policy text">
        <EmptyState
          icon="file-text" title={row.status === 'draft' && can('policies.edit') ? 'No text yet' : 'Not published yet'}
          message={can('policies.edit') ? 'Write the first version, have it approved, then publish it.' : 'This policy has no published version to read yet.'}
          action={can('policies.edit') && row.status !== 'retired' ? <Link className="btn btn-primary" to={`/policies/${row.id}/edit`}>Write the first version</Link> : undefined}
        />
      </Card>
    );
  }
  return (
    <Card title={published ? `Published text: version ${shown.version}` : `Version ${shown.version} (not published)`} actions={<VersionChip status={shown.status} />}>
      <VersionMeta v={shown} />
      <PolicyBody html={shown.body_html} />
    </Card>
  );
}

/** Says so when a newer version is on its way, so nobody mistakes the published text for the latest thinking. */
function Banner({ row, versions }: { row: Row; versions: PolicyVersion[] | undefined }) {
  if (row.status === 'retired') {
    return <div className="pol-notice" role="status"><p><strong>This policy is retired.</strong> Its text and history are kept for reference; nobody is asked to acknowledge it.</p></div>;
  }
  const latest = versions?.[0];
  const published = versions?.find((v) => v.status === 'published');
  if (!latest || !published || latest.id === published.id) return null;
  return (
    <div className="pol-notice pol-notice-info" role="status">
      <p>
        <strong>Version {latest.version} is {VERSION_STATUS[latest.status].label.toLowerCase()}.</strong>{' '}
        Readers still see version {published.version} until the new one is approved and published.
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

function Summary({ rec, versions }: { rec: RecordContext; versions: VersionsState }) {
  return (
    <div className="pol-layout">
      <Reader row={rec.row} versions={versions} />
      <div className="stack">
        <EditableSummary
          type="policy" row={rec.row} onSaved={rec.reload}
          fields={['title', 'summary', 'category', 'owner_id', 'approver_name', 'approver_role', 'review_date', 'current_version']}
        />
        <AudienceCard rec={rec} />
      </div>
    </div>
  );
}

export function PolicyDetail() {
  const { id } = useParams();
  const fetched = useFetch<PolicyVersion[]>(id ? `/api/policies/${id}/versions` : null);
  const versions: VersionsState = { data: fetched.data ?? undefined, error: fetched.error, reload: fetched.reload };
  const list = versions.data ?? [];

  return (
    <RecordPage
      type="policy"
      subtitle={(row) => (
        <span className="row">
          {row.status !== 'retired' && <><span>Review:</span><ReviewChip date={row.review_date} status={row.status} /></>}
          {row._display?.owner_id && <span>Owner: {row._display.owner_id}</span>}
        </span>
      )}
      actions={(rec) => <PolicyActions rec={rec} versions={versions.data} onChanged={() => { rec.reload(); versions.reload(); }} />}
      banner={({ row }) => <Banner row={row} versions={versions.data} />}
      summary={() => null}
      tabs={[
        { key: 'policy', label: 'Policy', content: (rec) => <Summary rec={rec} versions={versions} /> },
        { key: 'versions', label: 'Versions', count: list.length || undefined, content: () => (versions.data ? <VersionsPanel versions={versions.data} /> : <Card><Loading /></Card>) },
        { key: 'acknowledgements', label: 'Acknowledgements', content: ({ row }) => (versions.data ? <AckTracking row={row} versions={versions.data} /> : <Card><Loading /></Card>) },
        { key: 'outcomes', label: 'Mapped outcomes', content: ({ row }) => <OutcomesPanel row={row} /> },
        { key: 'exceptions', label: 'Exceptions', content: ({ row }) => <PolicyExceptions row={row} /> },
      ]}
    />
  );
}
