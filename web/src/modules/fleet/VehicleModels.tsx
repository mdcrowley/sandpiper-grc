// Vehicle models (E39): the list and one model's page (shared with asset models in
// inventory/models.tsx), plus the equipment a vehicle model adds to its mode's required equipment.
import { useState } from 'react';
import {
  api, Button, Card, EmptyState, errorMessage, ErrorState, IconButton, Loading, LookupSelect, NumberField, Notice, RecordPicker, TableWrap,
  useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { MODEL_KINDS, ModelDetail, ModelList } from '../inventory/models';
import { FleetTabs } from './shared';

const KIND = MODEL_KINDS.vehicle;

export function VehicleModelList() {
  return <ModelList kind={KIND} header={<FleetTabs active="models" />} />;
}

export function VehicleModelDetail() {
  const { can } = useAuth();
  return (
    <ModelDetail kind={KIND} extraTabs={can('assets.view')
      ? [{ key: 'equipment', label: 'Equipment', content: ({ row, canEdit }) => <ModelEquipment modelId={row.id} canEdit={canEdit} /> }]
      : []} />
  );
}

interface Item { asset_type: string; count: number; asset_model_id: string | null; asset_type_label?: string; asset_model_name?: string | null }

const plain = (items: Item[]) => items.map(({ asset_type, count, asset_model_id }) => ({ asset_type, count, asset_model_id }));

/** The kinds of equipment (and how many) this model adds to what its mode requires (E39-04). */
function ModelEquipment({ modelId, canEdit }: { modelId: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ items: Item[] }>(`/api/vehicle-models/${modelId}/equipment`);
  const [draft, setDraft] = useState<Item[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = draft !== null && JSON.stringify(plain(draft)) !== JSON.stringify(plain(data?.items ?? []));
  const unsaved = useUnsavedChanges(dirty);
  if (error) return <ErrorState title="The equipment could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  const set = (i: number, patch: Partial<Item>) => setDraft((d) => (d ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.put(`/api/vehicle-models/${modelId}/equipment`, { items: plain(draft ?? []) });
      unsaved.release();
      setDraft(null);
      toast.success('Equipment saved.');
      reload();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields ?? {};
      setErrors(fields);
      if (!Object.keys(fields).length) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const intro = (
    <p className="muted">
      What vehicles of this model carry on top of what their mode requires (set under Equipment coverage). A higher count raises the
      mode&apos;s; naming an asset model means only equipment of that model counts as working.
    </p>
  );
  if (draft) {
    return (
      <Card title="Equipment this model adds">
        <div className="stack">
          {intro}
          {Object.keys(errors).length > 0 && <Notice tone="error">Check the highlighted rows.</Notice>}
          {draft.map((it, i) => (
            <div key={i} className="mdl-equipment-row">
              <LookupSelect label="Kind of equipment" list="asset_type" value={it.asset_type} onChange={(v) => set(i, { asset_type: v ?? '' })} error={errors[`items.${i}.asset_type`]} />
              <NumberField label="How many" value={it.count} min={1} max={50} step={1} onChange={(v) => set(i, { count: v ?? 1 })} error={errors[`items.${i}.count`]} />
              <RecordPicker label="Asset model (optional)" type="asset_model" value={it.asset_model_id} display={it.asset_model_name ?? undefined}
                onChange={(id) => set(i, { asset_model_id: id })} error={errors[`items.${i}.asset_model_id`]} />
              <IconButton icon="trash" label={`Remove row ${i + 1}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="row">
            <Button icon="plus" onClick={() => setDraft([...draft, { asset_type: '', count: 1, asset_model_id: null }])}>Add equipment</Button>
          </div>
          <div className="row">
            <Button onClick={unsaved.guard(() => { setDraft(null); setErrors({}); })}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>Save</Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Equipment this model adds" flush
      actions={canEdit && <Button size="sm" icon="edit" onClick={() => setDraft(data.items.map(({ asset_type, count, asset_model_id, asset_model_name }) => ({ asset_type, count, asset_model_id, asset_model_name })))}>Edit</Button>}>
      <div className="fl-pad">{intro}</div>
      {data.items.length === 0 ? <EmptyState icon="box" title="Nothing added" message="Vehicles of this model need what their mode requires, one of each." /> : (
        <TableWrap label="Equipment this model adds">
          <table className="table">
            <caption className="sr-only">Equipment this model adds</caption>
            <thead><tr><th scope="col">Kind of equipment</th><th scope="col" className="num">How many</th><th scope="col">Asset model</th></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.asset_type}><td>{it.asset_type_label ?? it.asset_type}</td><td className="num">{it.count}</td><td>{it.asset_model_name ?? <span className="muted">Any</span>}</td></tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
