// Knowledge base: list, reader (with versions and "was this helpful") and editor.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ActivityPanel, api, Badge, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, HistoryPanel,
  Loading, LookupChip, NotFound, PageHeader, ResourceForm, ResourceList, Tabs, useAuth, useFetch, useRecord, useToast,
} from '../../core';
import type { Row } from '../../core';

const EDIT_FIELDS = ['title', 'category', 'audience', 'status', 'owner_id', 'review_on', 'body'];

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
      createFields={EDIT_FIELDS}
    />
  );
}

function ReviewDate({ value }: { value: string | null }) {
  if (!value) return <>—</>;
  const overdue = value < new Date().toISOString().slice(0, 10);
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
      {voted ? <span>Thank you. Your answer has been counted.</span> : (
        <>
          <span>Was this helpful?</span>
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

export function KnowledgeArticle({ editing = false }: { editing?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { row, error, reload } = useRecord('knowledge_article', id);

  if (error) {
    const status = (error as { status?: number }).status;
    return status === 404 ? <NotFound /> : <ErrorState error={error} onRetry={reload} />;
  }
  if (!row || !id) return <Loading label="Loading the article" />;
  const crumbs = [{ label: 'Knowledge base', to: '/knowledge' }, { label: row.ref ?? row.title, to: editing ? `/knowledge/${id}` : undefined }];

  if (editing) {
    return (
      <>
        <PageHeader title={`Edit: ${row.title}`} reference={row.ref} breadcrumbs={[...crumbs, { label: 'Edit' }]} />
        <Card>
          <p className="muted">Changing the article text makes version {Number(row.version ?? 1) + 1}; the current text is kept under Versions.</p>
          <ResourceForm
            type="knowledge_article" id={id} initial={row} fields={EDIT_FIELDS}
            onSaved={() => { reload(); navigate(`/knowledge/${id}`); }}
            onCancel={() => navigate(`/knowledge/${id}`)}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={row.title}
        reference={row.ref}
        breadcrumbs={crumbs}
        status={<span className="row"><LookupChip list="kb_status" value={row.status} /><LookupChip list="kb_audience" value={row.audience} /></span>}
        subtitle={<>Version {row.version} · updated {formatDateTime(row.updated_at)}{row._display?.owner_id ? ` · owner ${row._display.owner_id}` : ''}
          {row.review_on ? <> · review on <ReviewDate value={row.review_on} /></> : null}</>}
        actions={can('knowledge.edit') ? <Link className="sd-button-link" to={`/knowledge/${id}/edit`}>Edit article</Link> : undefined}
      />
      <Tabs
        label="Article sections"
        tabs={[
          { key: 'article', label: 'Article', content: (
            <Card>
              {row.status !== 'published' && <p className="sd-notice">This article is {String(row._display?.status ?? row.status).toLowerCase()} and is not shown to staff.</p>}
              <article className="sd-article">
                {row.body ? <div className="prose">{row.body}</div> : <EmptyState title="No text yet" message="Edit the article to add its content." icon="file-text" />}
              </article>
              {row.status === 'published' && <Helpful row={row} onVoted={reload} />}
            </Card>
          ) },
          { key: 'versions', label: 'Versions', count: Number(row.version ?? 1), content: <Card><Versions id={id} stamp={String(row.updated_at)} /></Card> },
          { key: 'activity', label: 'Activity', content: <ActivityPanel type="knowledge_article" id={id} /> },
          { key: 'history', label: 'History', content: <HistoryPanel type="knowledge_article" id={id} /> },
        ]}
      />
    </>
  );
}
