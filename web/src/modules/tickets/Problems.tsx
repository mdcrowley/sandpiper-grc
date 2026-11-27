// Problem records: recurring incidents, root cause, workaround, follow-up actions, and publishing a known error.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Badge, Button, Checkbox, EditableSummary, errorMessage, LookupChip, Modal, RecordPage, RecordPicker, ResourceList, useAuth, useToast,
} from '../../core';
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


interface Suggestion { id: string; ref: string; title: string; status: string }

/** E45-32: link several tickets to the problem from here: similar tickets offered first, any other ticket by search. */
function LinkedTickets({ rec }: { rec: RecordContext }) {
  const { row, canEdit } = rec;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setSuggested(null);
    // Similar tickets, less those already linked here.
    Promise.all([
      api.get<{ tickets: Suggestion[] }>(`/api/tickets/suggest?title=${encodeURIComponent(row.title ?? '')}`),
      api.get<{ rows: { id: string }[] }>(`/api/tickets?f.problem_id=${row.id}&pageSize=500`),
    ]).then(([s, linked]) => {
      const have = new Set(linked.rows.map((r) => r.id));
      if (!stale) setSuggested((s.tickets ?? []).filter((x) => !have.has(x.id)));
    }, () => { if (!stale) setSuggested([]); });
    return () => { stale = true; };
  }, [open, row.title]);

  const toggle = (id: string, label: string) => setChosen((old) => {
    const next = { ...old };
    if (next[id]) delete next[id]; else next[id] = label;
    return next;
  });

  async function link() {
    const ids = Object.keys(chosen);
    if (!ids.length) { setError('Choose at least one ticket.'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ linked: number; skipped: unknown[] }>(`/api/problems/${row.id}/tickets`, { ticket_ids: ids });
      toast.success(res.linked === 1 ? 'One ticket linked.' : `${res.linked} tickets linked.`);
      setOpen(false);
      setVersion((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sd-linked-head">
        <p className="muted">Tickets whose Problem field points here. Link them here, or from a ticket with "Link to a problem".</p>
        {canEdit && <Button icon="link" onClick={() => { setChosen({}); setPicker(null); setError(''); setOpen(true); }}>Link tickets</Button>}
      </div>
      <ResourceList
        key={version}
        type="ticket"
        baseFilter={{ problem_id: row.id }}
        urlState={false}
        columns={['ref', 'title', 'status', 'priority', 'requester_department', 'opened_at']}
        pageSize={10}
      />
      <Modal open={open} title="Link tickets to this problem" onClose={() => setOpen(false)} dirty={Object.keys(chosen).length > 0}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={link}>Link {Object.keys(chosen).length || ''}</Button></>}>
        <div className="stack">
          <fieldset className="sd-link-pick">
            <legend>Similar tickets</legend>
            {suggested === null && <p className="muted">Looking for tickets with a similar title…</p>}
            {suggested?.length === 0 && <p className="muted">No open or recent ticket has a similar title. Search for one below.</p>}
            {suggested?.map((s) => (
              <Checkbox key={s.id} label={`${s.ref} ${s.title}`} checked={!!chosen[s.id]} onChange={() => toggle(s.id, `${s.ref} ${s.title}`)} />
            ))}
          </fieldset>
          <RecordPicker label="Add another ticket" type="ticket" value={picker}
            onChange={(id, option) => { if (id && !chosen[id]) toggle(id, option?.label ?? id); setPicker(null); }} />
          {Object.keys(chosen).length > 0 && (
            <div className="row">
              {Object.entries(chosen).map(([id, label]) => (
                <Badge key={id} color="blue">{label}</Badge>
              ))}
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </Modal>
    </div>
  );
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
            content: (rec) => <LinkedTickets rec={rec} />,
          },
          ...(hasActions ? [{ key: 'actions', label: 'Actions', content: ({ row }: RecordContext) => <RecordActions sourceType="problem" sourceId={row.id} /> }] : []),
        ]}
      />
    </div>
  );
}
