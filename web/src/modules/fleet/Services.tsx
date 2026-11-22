// Services (routes and lines) and the systems each depends on.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, Loading, LookupSelect, Modal, PageHeader, RecordPage, RecordPicker,
  ResourceList, StatusChip, TableWrap, TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import { SafetyEventsCard } from './SafetyEvents';
import { FleetTabs } from './shared';

export function ServiceList() {
  return (
    <div className="stack">
      <PageHeader title="Services" subtitle="Routes and lines, and the systems each one needs to run." />
      <FleetTabs active="services" />
      <ResourceList
        type="service"
        urlState
        columns={['route_code', 'name', 'mode', 'service_type', 'status', 'depot_id']}
        filters={['mode', 'service_type', 'status', 'depot_id']}
        createFields={['route_code', 'name', 'mode', 'service_type', 'status', 'depot_id', 'description', 'notes']}
      />
    </div>
  );
}

interface Dependency {
  system_id: string; ref: string | null; name: string; dependency: string | null; dependency_label: string | null; notes: string | null;
  criticality_label: string | null; criticality_color: string;
}

function Dependencies({ serviceId, code }: { serviceId: string; code: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Dependency[]>(can('systems.view') ? `/api/services/${serviceId}/systems` : null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Dependency | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can('systems.view')) return <Card title="Systems this service depends on"><p className="muted">You need permission to see systems.</p></Card>;
  const canEdit = can('fleet.edit');
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await api.del(`/api/services/${serviceId}/systems/${removing.system_id}`); toast.success('Dependency removed.'); setRemoving(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Systems this service depends on" flush
      actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add system</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fl-pad"><Loading lines={3} label="Loading the systems" /></div>
        : data.length === 0 ? <EmptyState icon="server" title="No systems recorded" message="Record the CAD/AVL, fare, passenger information, scheduling and radio systems this service needs, so an outage shows which services it affects." />
        : (
          <TableWrap label={`Systems service ${code} depends on`}>
            <table className="table">
              <caption className="sr-only">Systems service {code} depends on</caption>
              <thead><tr><th scope="col">System</th><th scope="col">For</th><th scope="col">Criticality</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.system_id}>
                    <td><Link className="row-title" to={`/systems/${d.system_id}`}>{d.ref && <span className="ref">{d.ref}</span>} {d.name}</Link></td>
                    <td>{d.dependency_label ?? '—'}</td>
                    <td>{d.criticality_label ? <StatusChip color={d.criticality_color as ColorName} label={d.criticality_label} /> : '—'}</td>
                    <td>{d.notes ?? '—'}</td>
                    <td className="fl-actions">{canEdit && <Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>Remove</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      <AddDependency open={adding} serviceId={serviceId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast.success('System added.'); reload(); }} />
      <ConfirmDialog open={!!removing} title="Remove this dependency?" message={`Service ${code} will no longer be shown as affected when ${removing?.name ?? 'this system'} fails.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

function AddDependency({ open, serviceId, onClose, onDone }: { open: boolean; serviceId: string; onClose: () => void; onDone: () => void }) {
  const [systemId, setSystemId] = useState<string | null>(null);
  const [dependency, setDependency] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const close = () => { setSystemId(null); setDependency(''); setNotes(''); setErrors({}); setMessage(''); onClose(); };
  const dirty = !!systemId || !!dependency || !!notes.trim();
  const unsaved = useUnsavedChanges(open && dirty);
  const submit = async () => {
    if (!systemId) { setErrors({ system_id: 'Choose a system.' }); return; }
    setBusy(true); setErrors({}); setMessage('');
    try {
      await api.post(`/api/services/${serviceId}/systems`, { system_id: systemId, dependency: dependency || undefined, notes: notes || undefined });
      unsaved.release();
      setSystemId(null); setDependency(''); setNotes('');
      onDone();
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields); else setMessage(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Add a system this service depends on" onClose={close} dirty={open && dirty}
      footer={<><Button onClick={unsaved.guard(close)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add system</Button></>}>
      <div className="form">
        {message && <div className="form-error" role="alert">{message}</div>}
        <RecordPicker label="System" type="system" required value={systemId} onChange={(id) => setSystemId(id)} error={errors.system_id} />
        <LookupSelect label="Needed for" list="service_dependency" value={dependency} onChange={setDependency} error={errors.dependency} />
        <TextField label="Notes" value={notes} onChange={setNotes} />
      </div>
    </Modal>
  );
}

export function ServiceDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="service"
      title={(row) => `${row.route_code} ${row.name}`}
      summaryFields={['route_code', 'name', 'mode', 'service_type', 'status', 'depot_id', 'description', 'notes']}
      tabs={[
        { key: 'systems', label: 'Systems', content: ({ row }) => <Dependencies serviceId={row.id} code={row.route_code} /> },
        ...(can('safety.view') ? [{ key: 'safety', label: 'Safety events', content: ({ row }: { row: { id: string } }) => <SafetyEventsCard url={`/api/services/${row.id}/safety-events`} /> }] : []),
      ]}
    />
  );
}
