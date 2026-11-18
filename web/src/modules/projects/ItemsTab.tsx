import { useState } from 'react';
import {
  api, Badge, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, Loading, LookupChip, Menu,
  useAuth, useFetch, useLookup, useToast,
} from '../../core';
import { ItemDialog } from './ItemDialog';
import { todayIso, type ProjectItem } from './types';

const scoreColor = (score: number) => (score >= 15 ? 'red' : score >= 8 ? 'amber' : 'green');

/** Risks, issues, decisions and change requests for one project. A risk can be escalated to the enterprise register. */
export function ItemsTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const kinds = useLookup('project_item_kind');
  const { data, error, reload } = useFetch<ProjectItem[]>(`/api/projects/${projectId}/items`);
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState<ProjectItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [escalating, setEscalating] = useState<ProjectItem | null>(null);
  const [removing, setRemoving] = useState<ProjectItem | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can('projects.edit');
  const today = todayIso();
  const refresh = () => { reload(); onChanged(); };

  async function run(action: () => Promise<unknown>, done: string, close: () => void) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      close();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      close();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState title="Items could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const rows = kind ? data.filter((i) => i.kind === kind) : data;
  const kindLabel = kinds.find((k) => k.value === kind)?.label.toLowerCase();
  const add = canEdit
    ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setDialogOpen(true); }}>Add {kindLabel ?? 'item'}</Button>
    : undefined;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="prj-switch" role="group" aria-label="Kind of item">
          <button type="button" aria-pressed={kind === ''} onClick={() => setKind('')}>All ({data.length})</button>
          {kinds.map((k) => (
            <button key={k.value} type="button" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
              {k.label} ({data.filter((i) => i.kind === k.value).length})
            </button>
          ))}
        </div>
        {add}
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={kindLabel ? `No ${kindLabel} items recorded` : 'Nothing recorded yet'}
            message="Record risks, issues, decisions and change requests here so they are not lost in email."
            action={add}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Kind</th><th scope="col">Title</th><th scope="col">Owner</th><th scope="col">Status</th>
                  <th scope="col">Due</th><th scope="col">Risk score</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const overdue = item.due_on && item.due_on < today && !['closed', 'approved', 'rejected'].includes(item.status);
                  return (
                    <tr key={item.id}>
                      <td><LookupChip list="project_item_kind" value={item.kind} /></td>
                      <td>
                        <div className="row-title">{item.title}</div>
                        {item.detail && <div className="muted prose">{item.detail}</div>}
                        {item.escalated_risk_id && (
                          <div className="muted">Escalated to the enterprise risk register{item.escalated_at ? ` on ${formatDate(item.escalated_at)}` : ''}</div>
                        )}
                      </td>
                      <td>{item.owner_name ?? item.owner ?? '—'}</td>
                      <td><LookupChip list="project_item_status" value={item.status} /></td>
                      <td>{item.due_on ? <>{formatDate(item.due_on)}{overdue && <span className="prj-over"> overdue</span>}</> : '—'}</td>
                      <td>
                        {item.score
                          ? <Badge color={scoreColor(item.score)}>{item.score} ({item.likelihood} × {item.impact})</Badge>
                          : '—'}
                      </td>
                      <td>
                        {canEdit && (
                          <Menu
                            label={`Actions for ${item.title}`}
                            icon="more"
                            iconOnly
                            variant="ghost"
                            size="sm"
                            align="end"
                            items={[
                              { label: 'Edit', icon: 'edit', onSelect: () => { setEditing(item); setDialogOpen(true); } },
                              ...(item.kind === 'risk' ? [{
                                label: item.escalated_risk_id ? 'Already escalated' : 'Escalate to enterprise risk register',
                                icon: 'arrow-up' as const,
                                disabled: Boolean(item.escalated_risk_id),
                                onSelect: () => setEscalating(item),
                              }] : []),
                              { label: 'Delete', icon: 'trash', danger: true, separated: true, onSelect: () => setRemoving(item) },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ItemDialog
        projectId={projectId}
        open={dialogOpen}
        item={editing}
        defaultKind={kind || 'risk'}
        onClose={() => setDialogOpen(false)}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={Boolean(escalating)}
        title="Escalate this risk?"
        message={`"${escalating?.title ?? ''}" will be copied to the enterprise risk register, where the security lead manages it. The project risk stays here and is marked as escalated.`}
        confirmLabel="Escalate"
        busy={busy}
        onConfirm={() => run(() => api.post(`/api/projects/${projectId}/items/${escalating!.id}/escalate`, {}), 'Risk escalated to the enterprise risk register.', () => setEscalating(null))}
        onCancel={() => setEscalating(null)}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this item?"
        message={`"${removing?.title ?? ''}" will be removed from the project. The deletion is recorded in the history.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => run(() => api.del(`/api/projects/${projectId}/items/${removing!.id}`), 'Deleted.', () => setRemoving(null))}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
