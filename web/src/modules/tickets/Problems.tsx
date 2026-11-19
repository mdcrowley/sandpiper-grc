// Problem records: recurring incidents, root cause, workaround, follow-up actions, and publishing a known error.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Badge, Button, EditableSummary, errorMessage, LookupChip, RecordPage, ResourceList, useAuth, useToast } from '../../core';
import type { RecordContext, Row } from '../../core';
import { RecordActions, useHasActions } from './actions';

export function ProblemList() {
  return (
    <ResourceList
      type="problem"
      title="Problems"
      columns={['ref', 'title', 'status',
        { field: 'known_error', label: 'Known error', sortable: true, render: (row) => (row.known_error ? <Badge color="amber">Known error</Badge> : '—') },
        'owner_id', 'updated_at']}
      filters={['status', 'known_error', 'owner_id']}
      bulkFields={['status', 'owner_id', 'known_error']}
      createFields={['title', 'description', 'status', 'owner_id', 'root_cause', 'workaround', 'known_error']}
    />
  );
}

function PublishButton({ rec }: { rec: RecordContext }) {
  const { row, reload, canEdit } = rec;
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (row.knowledge_article_id) {
    return <Link className="btn btn-secondary" to={`/knowledge/${row.knowledge_article_id}`}>Open the known-error article</Link>;
  }
  if (!canEdit || !can('knowledge.create')) return null;
  async function publish() {
    setBusy(true);
    try {
      const article = await api.post<Row>(`/api/problems/${row.id}/publish-known-error`);
      toast.success(`Draft article ${article.ref} created. Review it, then publish.`);
      reload();
      navigate(`/knowledge/${article.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return <Button variant="primary" icon="book" loading={busy} onClick={publish}>Publish as known error</Button>;
}

export function ProblemDetail() {
  const hasActions = useHasActions();
  return (
    <div className="sd-record">
      <RecordPage
        type="problem"
        status={(row) => (
          <span className="row">
            <LookupChip list="problem_status" value={row.status} />
            {row.known_error && <Badge color="amber">Known error</Badge>}
          </span>
        )}
        actions={(rec) => <PublishButton rec={rec} />}
        summary={({ row, reload }) => (
          <>
            <div className="sd-main">
              <EditableSummary type="problem" row={row} onSaved={reload} title="What is known" fields={['description', 'workaround', 'root_cause']}
                sections={[{ fields: ['description'] }, { title: 'Workaround and cause', fields: ['workaround', 'root_cause'] }]} />
            </div>
            <aside className="sd-side" aria-label="Problem facts">
              <EditableSummary type="problem" row={row} onSaved={reload} fields={['title', 'status', 'owner_id', 'known_error', 'knowledge_article_id']} />
            </aside>
          </>
        )}
        tabs={[
          {
            key: 'tickets', label: 'Linked tickets',
            content: ({ row }) => (
              <div className="stack">
                <p className="muted">Tickets whose Problem field points here. To link one, open the ticket and set its Problem.</p>
                <ResourceList
                  type="ticket"
                  baseFilter={{ problem_id: row.id }}
                  urlState={false}
                  columns={['ref', 'title', 'status', 'priority', 'requester_department', 'opened_at']}
                  pageSize={10}
                />
              </div>
            ),
          },
          ...(hasActions ? [{ key: 'actions', label: 'Actions', content: ({ row }: RecordContext) => <RecordActions sourceType="problem" sourceId={row.id} /> }] : []),
        ]}
      />
    </div>
  );
}
