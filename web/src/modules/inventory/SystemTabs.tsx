// Tabs on the system record: integrations, data held, sites served and assets.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading,
  LookupSelect, Modal, RecordPicker, ResourceList, Select, StatusChip, TableWrap, TextArea, useAuth, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import { Callout } from './shared';

type Item = Record<string, any>;

/** A list of related rows with add and remove, and its loading, empty and error states. */
function LinkedList({
  url, title, addLabel, canEdit, emptyTitle, emptyMessage, columns, render, removeUrl, removeMessage, addDialog, editDialog, rowName, onChanged,
}: {
  url: string; title: string; addLabel: string; canEdit: boolean; emptyTitle: string; emptyMessage: string;
  columns: string[]; render: (row: Item) => ReactNode[];
  removeUrl: (row: Item) => string; removeMessage: (row: Item) => string;
  addDialog: (close: (changed: boolean) => void) => ReactNode;
  /** When given, each row has an Edit button that opens this dialog. */
  editDialog?: (row: Item, close: (changed: boolean) => void) => ReactNode;
  /** Names a row in the accessible names of its buttons ("Edit the integration with X"). */
  rowName?: (row: Item) => string;
  /** Told after a row is added or removed (the page keeps counts of these lists). */
  onChanged?: () => void;
}) {
  const { data, error, reload } = useFetch<Item[]>(url);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(removeUrl(removing));
      toast.success('Removed.');
      setRemoving(null);
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const addButton = canEdit ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>{addLabel}</Button> : undefined;
  return (
    <Card title={title} actions={addButton} flush={!!data?.length}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.length === 0 ? <EmptyState icon="link" title={emptyTitle} message={emptyMessage} action={addButton} />
        : (
          <TableWrap label={title} className="inv-wrap-cells">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => <th key={c} scope="col">{c}</th>)}
                  {canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.id ?? i}>
                    {render(row).map((cell, j) => <td key={j}>{cell}</td>)}
                    {canEdit && (
                      <td className="num">
                        <span className="inv-row-actions">
                          {editDialog && <IconButton icon="edit" label={rowName ? `Edit ${rowName(row)}` : 'Edit'} variant="ghost" size="sm" onClick={() => setEditing(row)} />}
                          <IconButton icon="trash" label={rowName ? `Remove ${rowName(row)}` : 'Remove'} variant="ghost" size="sm" onClick={() => setRemoving(row)} />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      {adding && addDialog((changed) => { setAdding(false); if (changed) { reload(); onChanged?.(); } })}
      {editing && editDialog?.(editing, (changed) => { setEditing(null); if (changed) { reload(); onChanged?.(); } })}
      <ConfirmDialog open={!!removing} title="Remove this link?" message={removing ? removeMessage(removing) : ''} confirmLabel="Remove" danger
        busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

/** Dialog that picks one record and posts it. */
function PickDialog({ title, type, label, post, field, onClose }: {
  title: string; type: string; label: string; post: string; field: string; onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!id) { setError(`Choose a ${label.toLowerCase()}.`); return; }
    setBusy(true);
    try {
      await api.post(post, { [field]: id });
      toast.success('Added.');
      onClose(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.fields?.[field] ?? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={title} onClose={() => onClose(false)} size="sm" dirty={Boolean(id)}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add</Button></>}>
      <RecordPicker label={label} type={type} value={id} onChange={(v) => { setId(v); setError(''); }} error={error} required />
    </Modal>
  );
}

const FLOW: Record<string, { label: string; color: ColorName }> = {
  out: { label: 'Sends to', color: 'blue' },
  in: { label: 'Receives from', color: 'teal' },
  both: { label: 'Both ways', color: 'purple' },
};

/** The direction of an integration as this system sees it, in the terms the API takes. */
const DIRECTION_OF_FLOW: Record<string, string> = { out: 'one_way', in: 'inbound', both: 'two_way' };

/** Adds an integration, or with `existing` changes its direction, method and notes. */
function IntegrationDialog({ systemId, existing, onClose }: { systemId: string; existing?: Item; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [other, setOther] = useState<string | null>(existing?.other_system_id ?? null);
  const [direction, setDirection] = useState<string>(existing ? DIRECTION_OF_FLOW[existing.flow] ?? 'one_way' : 'one_way');
  const [method, setMethod] = useState<string>(existing?.method ?? '');
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');
  const draft = JSON.stringify([other, direction, method, notes]);
  const [start] = useState(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!other) { setErrors({ to_system_id: 'Choose the other system.' }); return; }
    setBusy(true);
    try {
      if (existing) {
        await api.patch(`/api/systems/${systemId}/integrations/${existing.id}`, { direction, method: method || null, notes });
        toast.success('Integration changed.');
      } else {
        await api.post(`/api/systems/${systemId}/integrations`, { to_system_id: other, direction, method: method || null, notes });
        toast.success('Integration added.');
      }
      onClose(true);
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : { _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={existing ? `Edit the integration with ${existing.other_name}` : 'Add integration'} onClose={() => onClose(false)} dirty={draft !== start}
      footer={<><Button onClick={() => onClose(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{existing ? 'Save changes' : 'Add integration'}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {errors._form && <p className="form-error" role="alert">{errors._form}</p>}
        {existing ? (
          <div className="inv-fixed-field">
            <span className="inv-fixed-label">Other system</span>
            <Link to={`/systems/${existing.other_system_id}`}>{existing.other_ref ? `${existing.other_ref} ` : ''}{existing.other_name}</Link>
            <span className="muted">To connect a different system, remove this integration and add another.</span>
          </div>
        ) : (
          <RecordPicker label="Other system" type="system" value={other} onChange={(v) => { setOther(v); setErrors({}); }} error={errors.to_system_id} required />
        )}
        <div className="form-grid">
          <Select label="Direction of data" value={direction} onChange={(v) => setDirection(v || 'one_way')} error={errors.direction}
            options={[
              { value: 'one_way', label: 'This system sends to the other' },
              { value: 'inbound', label: 'This system receives from the other' },
              { value: 'two_way', label: 'Both ways' },
            ]} />
          <LookupSelect label="Method" list="integration_method" value={method} onChange={setMethod} error={errors.method} />
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={3} hint="For example what is exchanged and how often." />
      </form>
    </Modal>
  );
}

export function IntegrationsTab({ systemId, canEdit, onChanged }: { systemId: string; canEdit: boolean; onChanged?: () => void }) {
  return (
    <LinkedList onChanged={onChanged}
      url={`/api/systems/${systemId}/integrations`} title="Integrations" addLabel="Add integration" canEdit={canEdit}
      emptyTitle="No integrations recorded" emptyMessage="Record which systems this one sends data to or receives data from. They drive the relationship map and the impact list."
      columns={['Direction', 'System', 'Method', 'Notes']}
      render={(r) => [
        <StatusChip color={FLOW[r.flow]?.color ?? 'gray'} label={FLOW[r.flow]?.label ?? r.flow} />,
        <Link to={`/systems/${r.other_system_id}`}>{r.other_ref ? `${r.other_ref} ` : ''}{r.other_name}</Link>,
        r.method_label ?? '—',
        r.notes ?? '—',
      ]}
      removeUrl={(r) => `/api/systems/${systemId}/integrations/${r.id}`}
      removeMessage={(r) => `The integration with ${r.other_name} will be removed from both systems.`}
      addDialog={(close) => <IntegrationDialog systemId={systemId} onClose={close} />}
      editDialog={(row, close) => <IntegrationDialog systemId={systemId} existing={row} onClose={close} />}
      rowName={(r) => `the integration with ${r.other_name}`}
    />
  );
}

export function DataHeldTab({ systemId, canEdit, recorded, onChanged }: { systemId: string; canEdit: boolean; recorded?: string | null; onChanged?: () => void }) {
  const { can } = useAuth();
  if (!can('data.view')) return <EmptyState icon="lock" title="No access" message="You do not have permission to see data categories." />;
  return (
    <div className="stack">
      {recorded && (
        <Callout color="gray" title="Sensitive data held, as first recorded">
          <span className="prose">{recorded}</span>
        </Callout>
      )}
      <LinkedList onChanged={onChanged}
        url={`/api/systems/${systemId}/data-categories`} title="Data categories held" addLabel="Add data category" canEdit={canEdit}
        emptyTitle="No data categories linked" emptyMessage="Link the categories of data this system holds. Sensitive categories without multi-factor sign-in appear on the inventory reports."
        columns={['Data category', 'Sensitivity', 'Custodian', 'Retention']}
        render={(r) => [
          <Link to={`/data-categories/${r.id}`}>{r.name}</Link>,
          r.sensitivity_label ? <StatusChip color={r.sensitivity_color} label={r.sensitivity_label} /> : <span className="muted">Not classified</span>,
          r.custodian ?? '—',
          r.retention_period ?? '—',
        ]}
        removeUrl={(r) => `/api/systems/${systemId}/data-categories/${r.id}`}
        removeMessage={(r) => `${r.name} will no longer be recorded as held in this system.`}
        rowName={(r) => r.name}
        addDialog={(close) => (
          <PickDialog title="Add data category" type="data_category" label="Data category" field="data_category_id"
            post={`/api/systems/${systemId}/data-categories`} onClose={close} />
        )}
      />
    </div>
  );
}

export function SitesServed({ systemId, canEdit }: { systemId: string; canEdit: boolean }) {
  const { can } = useAuth();
  if (!can('sites.view')) return null;
  return (
    <LinkedList
      url={`/api/systems/${systemId}/sites`} title="Sites served" addLabel="Add site" canEdit={canEdit}
      emptyTitle="No sites linked" emptyMessage="Link the sites that rely on this system so they show on the map and in the impact list."
      columns={['Site', 'Address', 'Function']}
      render={(r) => [<Link to={`/sites/${r.id}`}>{r.name}</Link>, r.address ?? '—', r.function ?? '—']}
      removeUrl={(r) => `/api/systems/${systemId}/sites/${r.id}`}
      removeMessage={(r) => `${r.name} will no longer be recorded as served by this system.`}
      rowName={(r) => r.name}
      addDialog={(close) => <PickDialog title="Add site served" type="site" label="Site" field="site_id" post={`/api/systems/${systemId}/sites`} onClose={close} />}
    />
  );
}

export function SystemAssetsTab({ systemId }: { systemId: string }) {
  const { can } = useAuth();
  if (!can('assets.view')) return <EmptyState icon="lock" title="No access" message="You do not have permission to see assets." />;
  return (
    <ResourceList
      type="asset"
      baseFilter={{ system_id: systemId }}
      columns={['tag', 'name', 'asset_type', 'status', 'site_id', 'support_end']}
      filters={['status', 'asset_type']}
      createFields={['name', 'asset_type', 'status', 'make', 'model', 'serial', 'site_id']}
      createInitial={{ system_id: systemId }}
    />
  );
}
