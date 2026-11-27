import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Group, SegmentedControl, Text } from '@mantine/core';
import {
  api, Badge, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, Icon, Loading, LookupChip, Menu,
  TableWrap, useAuth, useFetch, useLookup, useResource, useToast,
} from '../../core';
import { Person } from './bits';
import { ItemDialog } from './ItemDialog';
import { todayIso, type ProjectItem } from './types';

const scoreColor = (score: number) => (score >= 15 ? 'red' : score >= 8 ? 'amber' : 'green');
const plural = (label: string) => (/s$/.test(label) ? label : `${label}s`);

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
  // Escalating adds to the organization's risk register, so it needs create on risks as well.
  const riskRegister = Boolean(useResource('risk'));
  const mayEscalate = can('risks.create');
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
      <Group justify="space-between" gap="sm">
        <SegmentedControl
          aria-label="Kind of item"
          value={kind}
          onChange={setKind}
          data={[
            { value: '', label: `All (${data.length})` },
            ...kinds.map((k) => ({ value: k.value, label: `${plural(k.label)} (${data.filter((i) => i.kind === k.value).length})` })),
          ]}
        />
        {add}
      </Group>
      {riskRegister && !mayEscalate && data.some((i) => i.kind === 'risk' && !i.escalated_risk_id) && (
        <Text size="sm" c="dimmed">
          Escalating a risk adds it to the organization's risk register, which needs permission to create risks there. Ask someone who manages the risk register.
        </Text>
      )}

      <Card flush>
        {rows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={kindLabel ? `No ${kindLabel} items recorded` : 'Nothing recorded yet'}
            message="Record risks, issues, decisions and change requests here so they are not lost in email."
            action={add}
          />
        ) : (
          <TableWrap label={kindLabel ? `Project ${kindLabel} items` : 'Project items'} className="prj-scroll">
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
                          <div className="muted">
                            <Icon name="arrow-up" size={13} /> Escalated to the risk register{item.escalated_at ? ` on ${formatDate(item.escalated_at)}` : ''}
                            {can('risks.view') && <> · <Link to={`/risks/${item.escalated_risk_id}`}>Open the risk</Link></>}
                          </div>
                        )}
                      </td>
                      <td><Person name={item.owner_name ?? item.owner} placeholder="No owner" /></td>
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
                              ...(item.kind === 'risk' && riskRegister ? [{
                                label: item.escalated_risk_id ? 'Already escalated' : 'Escalate to risk register',
                                icon: 'arrow-up' as const,
                                disabled: Boolean(item.escalated_risk_id) || !mayEscalate,
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
          </TableWrap>
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
        message={`"${escalating?.title ?? ''}" will be copied to the organization's risk register, where whoever manages risks takes it on. The project risk stays here and is marked as escalated.`}
        confirmLabel="Escalate"
        busy={busy}
        onConfirm={() => run(() => api.post(`/api/projects/${projectId}/items/${escalating!.id}/escalate`, {}), 'Risk escalated to the risk register.', () => setEscalating(null))}
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
