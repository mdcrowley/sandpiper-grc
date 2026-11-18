// Problem records: recurring incidents, root cause, workaround, and publishing a known error.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Badge, Button, errorMessage, LookupChip, RecordPage, ResourceList, useAuth, useToast } from '../../core';
import type { RecordContext, Row } from '../../core';

export function ProblemList() {
  return (
    <ResourceList
      type="problem"
      title="Problems"
      columns={['ref', 'title', 'status',
        { field: 'known_error', label: 'Known error', sortable: true, render: (row) => (row.known_error ? <Badge color="amber">Known error</Badge> : '—') },
        'owner_id', 'updated_at']}
      filters={['status', 'known_error', 'owner_id']}
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
    return <Link className="sd-link" to={`/knowledge/${row.knowledge_article_id}`}>Open the known-error article</Link>;
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
  return (
    <RecordPage
      type="problem"
      status={(row) => (
        <span className="row">
          <LookupChip list="problem_status" value={row.status} />
          {row.known_error && <Badge color="amber">Known error</Badge>}
        </span>
      )}
      actions={(rec) => <PublishButton rec={rec} />}
      summaryFields={['title', 'description', 'status', 'owner_id', 'root_cause', 'workaround', 'known_error', 'knowledge_article_id']}
      tabs={[{
        key: 'tickets', label: 'Linked tickets',
        content: ({ row }) => (
          <div className="stack">
            <p className="muted">Tickets whose Problem field points here. To link one, open the ticket and set its Problem.</p>
            <ResourceList
              type="ticket"
              baseFilter={{ problem_id: row.id }}
              columns={['ref', 'title', 'status', 'priority', 'requester_department', 'opened_at']}
              pageSize={10}
            />
          </div>
        ),
      }]}
    />
  );
}
