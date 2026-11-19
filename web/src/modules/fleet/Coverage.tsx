// Equipment coverage: one row per vehicle, one column per kind of required equipment, so the
// vehicles without a working router or camera stand out. Administrators set what each mode needs.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, EmptyState, errorMessage, ErrorState, Icon, Loading, Modal, PageHeader, RecordPicker, Select, Stat,
  StatusChip, Switch, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import { FleetTabs } from './shared';

interface Coverage {
  columns: { value: string; label: string; ok: number; not_working: number; missing: number }[];
  vehicles: {
    id: string; fleet_number: string; mode: string; mode_label: string; status_label: string; status_color: string;
    depot_name: string | null; cells: Record<string, 'ok' | 'not_working' | 'missing' | 'not_required'>; gaps: number;
  }[];
  summary: { vehicles: number; with_gaps: number; fully_equipped: number };
}

const CELL = {
  ok: { icon: 'check-circle', label: 'Working', cls: 'fl-cell-ok' },
  not_working: { icon: 'alert-circle', label: 'Installed, not working', cls: 'fl-cell-warn' },
  missing: { icon: 'x', label: 'Missing', cls: 'fl-cell-bad' },
} as const;

export function CoveragePage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const modes = useLookup('vehicle_mode');
  const mode = params.get('mode') ?? '';
  const depot = params.get('depot_id');
  const gapsOnly = params.get('gaps') === 'true';
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const qs = new URLSearchParams({ ...(mode ? { mode } : {}), ...(depot ? { depot_id: depot } : {}), ...(gapsOnly ? { gaps: 'true' } : {}) }).toString();
  const { data, error, reload } = useFetch<Coverage>(`/api/fleet/coverage${qs ? `?${qs}` : ''}`, { keepPrevious: true });
  const [editing, setEditing] = useState(false);

  return (
    <div className="stack">
      <PageHeader title="Equipment coverage" subtitle="Which vehicles carry working equipment of every kind their mode needs."
        actions={can('fleet.administer') && <Button icon="settings" onClick={() => setEditing(true)}>Required equipment</Button>} />
      <FleetTabs active="coverage" />
      {data && (
        <div className="grid-stats">
          <Stat label="Vehicles" value={data.summary.vehicles} icon="bus" hint="Not counting retired vehicles" />
          <Stat label="Fully equipped" value={data.summary.fully_equipped} color="green" icon="check-circle" />
          <Stat label="With a gap" value={data.summary.with_gaps} color={data.summary.with_gaps ? 'red' : undefined} icon="alert" hint="Missing or not working"
            to={`/fleet/coverage?${new URLSearchParams({ ...(mode ? { mode } : {}), gaps: 'true' }).toString()}`} />
        </div>
      )}
      <Card>
        <div className="fl-filters">
          <Select label="Mode" value={mode} onChange={(v) => set('mode', v)} options={[{ value: '', label: 'All modes' }, ...modes.map((m) => ({ value: m.value, label: m.label }))]} />
          <RecordPicker label="Depot or garage" type="site" value={depot} onChange={(id) => set('depot_id', id)} placeholder="All depots" />
          <Switch label="Only vehicles with a gap" checked={gapsOnly} onChange={(on) => set('gaps', on ? 'true' : null)} />
        </div>
      </Card>
      {error && !data ? <ErrorState title="Coverage could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={8} label="Loading coverage" />
        : data.vehicles.length === 0 ? (
          <EmptyState icon="check-circle" title={gapsOnly ? 'No gaps' : 'No vehicles'}
            message={gapsOnly ? 'Every vehicle shown carries working equipment of every required kind.' : 'Add vehicles, or change the filters.'} />
        ) : (
          <Card flush>
            <ul className="fl-legend" aria-label="Key">
              {Object.entries(CELL).map(([k, c]) => <li key={k}><span className={`fl-cell ${c.cls}`}><Icon name={c.icon} size={16} /></span>{c.label}</li>)}
              <li><span className="fl-cell fl-cell-na">—</span>Not needed for this mode</li>
            </ul>
            <div className="table-wrap fl-coverage">
              <table className="table">
                <caption className="sr-only">Equipment coverage by vehicle</caption>
                <thead>
                  <tr>
                    <th scope="col">Vehicle</th>
                    {data.columns.map((c) => (
                      <th key={c.value} scope="col" className="fl-col">
                        {c.label}
                        <div className="muted fl-col-sub">{c.missing + c.not_working ? `${c.missing + c.not_working} gap${c.missing + c.not_working === 1 ? '' : 's'}` : 'No gaps'}</div>
                      </th>
                    ))}
                    <th scope="col" className="num">Gaps</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vehicles.map((v) => (
                    <tr key={v.id}>
                      <th scope="row" className="fl-rowhead">
                        <Link className="row-title" to={`/vehicles/${v.id}?tab=equipment`}>{v.fleet_number}</Link>
                        <div className="fl-sub"><span className="muted">{[v.mode_label, v.depot_name].filter(Boolean).join(' · ')}</span> <StatusChip size="sm" color={v.status_color as ColorName} label={v.status_label} /></div>
                      </th>
                      {data.columns.map((c) => {
                        const s = v.cells[c.value];
                        if (s === 'not_required') return <td key={c.value} className="fl-col"><span className="fl-cell fl-cell-na" aria-label="Not needed">—</span></td>;
                        const cell = CELL[s];
                        return <td key={c.value} className="fl-col"><span className={`fl-cell ${cell.cls}`} title={`${c.label}: ${cell.label}`}><Icon name={cell.icon} size={16} label={cell.label} /></span></td>;
                      })}
                      <td className="num">{v.gaps ? <strong>{v.gaps}</strong> : <span className="muted">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      <RequirementsDialog open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
    </div>
  );
}

function RequirementsDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const modes = useLookup('vehicle_mode');
  const types = useLookup('asset_type');
  const { data } = useFetch<Record<string, string[]>>(open ? '/api/fleet/requirements' : null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const toggle = (mode: string, type: string, on: boolean) =>
    setDraft((d) => ({ ...d, [mode]: on ? [...(d[mode] ?? []), type] : (d[mode] ?? []).filter((t) => t !== type) }));
  const save = async () => {
    setBusy(true);
    try { await api.put('/api/fleet/requirements', draft); toast.success('Required equipment saved.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Required equipment" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      {!data ? <Loading lines={6} /> : (
        <div className="stack">
          <p className="muted">Tick the kinds of equipment each mode of vehicle should carry. Coverage counts equipment as working when its asset status is In use.</p>
          {modes.map((m) => (
            <fieldset key={m.value} className="fl-req">
              <legend>{m.label}</legend>
              <div className="fl-req-grid">
                {types.map((t) => (
                  <Checkbox key={t.value} label={t.label} checked={(draft[m.value] ?? []).includes(t.value)} onChange={(on) => toggle(m.value, t.value, on)} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </Modal>
  );
}
