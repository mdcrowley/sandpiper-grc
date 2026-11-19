// Knowledge base: list, reader (article, versions, "was this helpful") and editor.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, Badge, Button, Card, DefinitionList, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime,
  Loading, LookupChip, NotFound, PageHeader, RecordPage, ResourceForm, ResourceList, useAuth, useFetch, useRecord, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';

const EDIT_FIELDS = ['title', 'body', 'category', 'audience', 'status', 'owner_id', 'review_on'];
const SECTIONS = [
  { title: 'Article', fields: ['title', 'body'] },
  { title: 'Publishing', description: 'Who can read it, and when it should be looked at again.', fields: ['category', 'audience', 'status', 'owner_id', 'review_on'] },
];
const HINTS = {
  body: 'Shown as plain text. Leave a blank line between paragraphs.',
  audience: '“IT agents only” hides the article from everyone who does not work tickets.',
  status: 'Only published articles are suggested on tickets.',
  review_on: 'The list flags the article once this date has passed.',
};

export function KnowledgeList() {
  return (
    <ResourceList
      type="knowledge_article"
      title="Knowledge base"
      columns={['ref', 'title', 'category', 'audience', 'status', 'owner_id',
        { field: 'review_on', sortable: true, render: (row) => <ReviewDate value={row.review_on} /> },
        { field: 'helpful_yes', label: 'Helpful', sortable: true, render: (row) => `${row.helpful_yes ?? 0} yes · ${row.helpful_no ?? 0} no` },
        'updated_at']}
      filters={['status', 'category', 'audience', 'owner_id', 'review_on']}
      bulkFields={['status', 'category', 'owner_id', 'review_on']}
      createFields={EDIT_FIELDS}
    />
  );
}

function ReviewDate({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const overdue = String(value).slice(0, 10) < new Date().toISOString().slice(0, 10);
  return overdue ? <span className="sd-late">{formatDate(value)} (review due)</span> : <>{formatDate(value)}</>;
}

interface Version { version: number; title: string; body: string | null; saved_at: string; saved_by_name: string | null; current: boolean }

function Helpful({ row, onVoted }: { row: Row; onVoted: () => void }) {
  const toast = useToast();
  const [voted, setVoted] = useState(false);
  const [busy, setBusy] = useState(false);
  async function vote(helpful: boolean) {
    setBusy(true);
    try {
      await api.post(`/api/knowledge/${row.id}/feedback`, { helpful });
      setVoted(true);
      onVoted();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sd-helpful" aria-live="polite">
      {voted ? <span>Thank you. Your answer has been counted (one per person for each version; answering again replaces it).</span> : (
        <>
          <strong>Was this helpful?</strong>
          <Button size="sm" icon="check" loading={busy} onClick={() => vote(true)}>Yes</Button>
          <Button size="sm" icon="x" loading={busy} onClick={() => vote(false)}>No</Button>
        </>
      )}
      <span className="muted">{row.helpful_yes ?? 0} found it helpful, {row.helpful_no ?? 0} did not</span>
    </div>
  );
}

function Versions({ id, stamp }: { id: string; stamp: string }) {
  const { data, error, reload } = useFetch<Version[]>(`/api/knowledge/${id}/versions?at=${encodeURIComponent(stamp)}`);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (data.length <= 1) {
    return <EmptyState title="Only one version so far" message="A new version is kept every time the article text changes." icon="history" />;
  }
  return (
    <ul className="sd-versions">
      {data.map((v) => (
        <li key={v.version}>
          <div className="row">
            <strong>Version {v.version}</strong>
            {v.current && <Badge color="green">Current</Badge>}
            <span className="muted">{formatDateTime(v.saved_at)}{v.saved_by_name ? ` · ${v.saved_by_name}` : ''}</span>
            {!v.current && (
              <Button size="sm" variant="ghost" aria-expanded={open === v.version} onClick={() => setOpen(open === v.version ? null : v.version)}>
                {open === v.version ? 'Hide text' : 'Show text'}
              </Button>
            )}
          </div>
          {open === v.version && <div className="sd-article sd-article-old"><h3>{v.title}</h3><div className="prose">{v.body || 'No text.'}</div></div>}
        </li>
      ))}
    </ul>
  );
}

function Reader({ rec }: { rec: RecordContext }) {
  const { row, reload } = rec;
  return (
    <>
      <div className="sd-main">
        <Card>
          {row.status !== 'published' && (
            <p className="notice notice-pilot">This article is {String(row._display?.status ?? row.status).toLowerCase()} and is not shown to staff.</p>
          )}
          <article className="sd-article">
            {row.body ? <div className="prose">{row.body}</div> : <EmptyState title="No text yet" message="Edit the article to add its content." icon="file-text" />}
          </article>
          {row.status === 'published' && <Helpful row={row} onVoted={reload} />}
        </Card>
      </div>
      <aside className="sd-side" aria-label="About this article">
        <Card title="About this article">
          <DefinitionList items={[
            { label: 'Category', value: row.category ? <LookupChip list="kb_category" value={row.category} /> : '—' },
            { label: 'Audience', value: <LookupChip list="kb_audience" value={row.audience} /> },
            { label: 'Owner', value: row._display?.owner_id ?? '—' },
            { label: 'Review on', value: <ReviewDate value={row.review_on} /> },
            { label: 'Version', value: `${row.version ?? 1}, saved ${formatDateTime(row.updated_at)}` },
            { label: 'Feedback', value: `${row.helpful_yes ?? 0} helpful · ${row.helpful_no ?? 0} not` },
          ]} />
        </Card>
      </aside>
    </>
  );
}

function ArticleEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const { row, error, reload } = useRecord('knowledge_article', id);
  if (error) {
    const status = (error as { status?: number }).status;
    return status === 404 ? <NotFound /> : <ErrorState error={error} onRetry={reload} />;
  }
  if (!row) return <Loading label="Loading the article" />;
  return (
    <>
      <PageHeader title={`Edit: ${row.title}`} reference={row.ref}
        breadcrumbs={[{ label: 'Knowledge base', to: '/knowledge' }, { label: row.ref ?? row.title, to: `/knowledge/${id}` }, { label: 'Edit' }]} />
      <Card>
        <p className="notice">Changing the article text makes version {Number(row.version ?? 1) + 1}. The current text is kept under Versions.</p>
        <ResourceForm
          type="knowledge_article" id={id} initial={row} fields={EDIT_FIELDS} sections={SECTIONS} hints={HINTS}
          onSaved={() => navigate(`/knowledge/${id}`)}
          onCancel={() => navigate(`/knowledge/${id}`)}
        />
      </Card>
    </>
  );
}

export function KnowledgeArticle({ editing = false }: { editing?: boolean }) {
  const { id } = useParams();
  const { can } = useAuth();
  if (editing && id) return <ArticleEditor id={id} />;
  return (
    <div className="sd-record">
      <RecordPage
        type="knowledge_article"
        breadcrumbs={undefined}
        status={(row) => <span className="row"><LookupChip list="kb_status" value={row.status} /><LookupChip list="kb_audience" value={row.audience} /></span>}
        subtitle={(row) => <>Version {row.version} · updated {formatDateTime(row.updated_at)}{row._display?.owner_id ? ` · owner ${row._display.owner_id}` : ''}</>}
        actions={({ row }) => (can('knowledge.edit') ? <Link className="btn btn-secondary" to={`/knowledge/${row.id}/edit`}>Edit article</Link> : null)}
        summary={(rec) => <Reader rec={rec} />}
        tabs={[{ key: 'versions', label: 'Versions', content: ({ row }) => <Card><Versions id={row.id} stamp={String(row.updated_at)} /></Card> }]}
        defaultTabs={['activity', 'attachments', 'links', 'history']}
      />
    </div>
  );
}
