// The equipment on one vehicle: what it should carry and whether that works, what is installed,
// and every earlier installation. Install and remove from here.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, DateField, EmptyState, errorMessage, ErrorState, formatDate, Loading, Modal, RecordPicker, StatusChip, TextArea,
  useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import type { Installation } from './shared';

interface EquipmentData {
  installations: Installation[];
  required: { asset_type: string; label: string; state: 'ok' | 'not_working' | 'missing' }[];
}

const STATE = {
  ok: { color: 'green', label: 'Working' },
  not_working: { color: 'amber', label: 'Not working' },
  missing: { color: 'red', label: 'Missing' },
} as const;

export function EquipmentPanel({ vehicleId, fleetNumber, retired }: { vehicleId: string; fleetNumber: string; retired: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<EquipmentData>(can('assets.view') ? `/api/vehicles/${vehicleId}/equipment` : null);
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState<Installation | null>(null);

  if (!can('assets.view')) return <Card title="Equipment"><p className="muted">You need permission to see assets to see the equipment on this vehicle.</p></Card>;
  if (error) return <ErrorState title="The equipment could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading the equipment" />;

  const current = data.installations.filter((i) => i.current);
  const past = data.installations.filter((i) => !i.current);
  const canEdit = can('fleet.edit');
  const gaps = data.required.filter((r) => r.state !== 'ok').length;

  return (
    <div className="stack">
      <Card title="Required equipment" actions={data.required.length > 0 && (
        gaps ? <span className="chip chip-red">{gaps} {gaps === 1 ? 'gap' : 'gaps'}</span> : <span className="chip chip-green">Fully equipped</span>
      )}>
        {data.required.length === 0
          ? <p className="muted">Nothing is required for this mode of vehicle. An administrator sets this on the Equipment coverage page.</p>
          : (
            <ul className="fl-required" aria-label="Required equipment and its state">
              {data.required.map((r) => (
                <li key={r.asset_type}>
                  <span>{r.label}</span>
                  <StatusChip color={STATE[r.state].color} label={STATE[r.state].label} />
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title="Installed now" flush actions={canEdit && !retired && <Button size="sm" icon="plus" onClick={() => setInstalling(true)}>Install equipment</Button>}>
        {current.length === 0
          ? <EmptyState icon="box" title="Nothing installed" message={retired ? 'This vehicle is retired.' : 'Install equipment from the asset register to track it here.'} />
          : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Equipment installed on {fleetNumber}</caption>
                <thead><tr><th scope="col">Equipment</th><th scope="col">Type</th><th scope="col">Asset status</th><th scope="col">Installed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {current.map((i) => (
                    <tr key={i.id}>
                      <td><Link className="row-title" to={`/assets/${i.asset_id}`}>{i.tag ? <span className="ref">{i.tag}</span> : null} {i.asset_name}</Link></td>
                      <td>{i.asset_type_label ?? '—'}</td>
                      <td><StatusChip color={i.asset_status_color as ColorName} label={i.asset_status_label ?? '—'} /></td>
                      <td>{formatDate(i.installed_on)}{i.install_notes && <div className="muted fl-note">{i.install_notes}</div>}</td>
                      <td className="fl-actions">{canEdit && <Button size="sm" variant="ghost" onClick={() => setRemoving(i)}>Remove</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card title="Earlier installations" flush>
        {past.length === 0 ? <p className="muted fl-pad">No equipment has been removed from this vehicle.</p> : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Equipment removed from {fleetNumber}</caption>
              <thead><tr><th scope="col">Equipment</th><th scope="col">Type</th><th scope="col">Installed</th><th scope="col">Removed</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {past.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/assets/${i.asset_id}`}>{i.tag ? <span className="ref">{i.tag}</span> : null} {i.asset_name}</Link></td>
                    <td>{i.asset_type_label ?? '—'}</td>
                    <td>{formatDate(i.installed_on)}</td>
                    <td>{formatDate(i.removed_on)}{i.removed_by && <div className="muted fl-note">by {i.removed_by}</div>}</td>
                    <td>{i.removal_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InstallDialog open={installing} vehicleId={vehicleId} fleetNumber={fleetNumber} onClose={() => setInstalling(false)}
        onDone={() => { setInstalling(false); toast.success('Equipment installed.'); reload(); }} />
      <RemoveDialog install={removing} vehicleId={vehicleId} onClose={() => setRemoving(null)}
        onDone={() => { setRemoving(null); toast.success('Equipment removed.'); reload(); }} />
    </div>
  );
}

function InstallDialog({ open, vehicleId, fleetNumber, onClose, onDone }: { open: boolean; vehicleId: string; fleetNumber: string; onClose: () => void; onDone: () => void }) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [on, setOn] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const close = () => { setAssetId(null); setOn(''); setNotes(''); setErrors({}); setMessage(''); onClose(); };
  const dirty = !!assetId || !!on || !!notes.trim();
  const unsaved = useUnsavedChanges(open && dirty);
  const submit = async () => {
    if (!assetId) { setErrors({ asset_id: 'Choose the equipment to install.' }); return; }
    setBusy(true); setErrors({}); setMessage('');
    try {
      await api.post(`/api/vehicles/${vehicleId}/equipment`, { asset_id: assetId, installed_on: on || undefined, install_notes: notes || undefined });
      unsaved.release();
      setAssetId(null); setOn(''); setNotes('');
      onDone();
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields); else setMessage(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={`Install equipment on ${fleetNumber}`} onClose={close} dirty={open && dirty}
      footer={<><Button onClick={unsaved.guard(close)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Install</Button></>}>
      <div className="form">
        {message && <div className="form-error" role="alert">{message}</div>}
        <RecordPicker label="Equipment (asset)" type="asset" required value={assetId} onChange={(id) => setAssetId(id)} error={errors.asset_id}
          hint="Search the asset register by tag or name. Equipment already on another vehicle must be removed there first." />
        <DateField label="Installed on" value={on} onChange={setOn} error={errors.installed_on} hint="Leave empty for today." />
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} />
      </div>
    </Modal>
  );
}

function RemoveDialog({ install, vehicleId, onClose, onDone }: { install: Installation | null; vehicleId: string; onClose: () => void; onDone: () => void }) {
  const [off, setOff] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const close = () => { setOff(''); setReason(''); setErrors({}); setMessage(''); onClose(); };
  const dirty = !!install && (!!off || !!reason.trim());
  const unsaved = useUnsavedChanges(dirty);
  const submit = async () => {
    if (!install) return;
    setBusy(true); setErrors({}); setMessage('');
    try {
      await api.post(`/api/vehicles/${vehicleId}/equipment/${install.id}/remove`, { removed_on: off || undefined, removal_reason: reason || undefined });
      unsaved.release();
      setOff(''); setReason('');
      onDone();
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields); else setMessage(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={!!install} title={`Remove ${install?.asset_name ?? 'equipment'}`} onClose={close} size="sm" dirty={dirty}
      footer={<><Button onClick={unsaved.guard(close)}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Remove</Button></>}>
      <div className="form">
        {message && <div className="form-error" role="alert">{message}</div>}
        <p className="muted">The installation stays in the vehicle's history. The asset itself is not changed.</p>
        <DateField label="Removed on" value={off} onChange={setOff} error={errors.removed_on} hint="Leave empty for today." />
        <TextArea label="Reason" value={reason} onChange={setReason} rows={2} placeholder="For example: faulty, moved to another vehicle" />
      </div>
    </Modal>
  );
}
