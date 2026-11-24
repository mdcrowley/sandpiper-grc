// Vehicle and asset models (E39): the pages of a model, its members, a change's preview, the
// "From model" notes on a member, "New ... from this model" and assigning a model to many records.
// Asset models are inventory's (always on); vehicle models are the fleet's, and the fleet module
// mounts their pages (fleet/VehicleModels.tsx), so they follow the Fleet and services switch.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Badge, Button, Card, Checkbox, EmptyState, errorMessage, ErrorState, FieldControl, FieldValue, formatDateTime, Loading, Modal,
  Notice, PageHeader, ProgressBar, RecordPage, RecordPicker, ResourceList, StatusChip, TableWrap, useAuth, useFetch, useResource, useToast,
} from '../../core';
import type { ColorName, RecordTab, Row } from '../../core';
import './models.css';

export type ModelKindKey = 'vehicle' | 'asset';

export interface ModelKind {
  key: ModelKindKey;
  modelType: string;
  memberType: string;
  base: string;
  /** The members' API path. */
  memberPath: string;
  route: string;
  memberRoute: string;
  label: string;
  plural: string;
  member: string;
  members: string;
  module: string;
}

export const MODEL_KINDS: Record<ModelKindKey, ModelKind> = {
  vehicle: {
    key: 'vehicle', modelType: 'vehicle_model', memberType: 'vehicle', base: '/api/vehicle-models', memberPath: '/api/vehicles', route: '/vehicle-models', memberRoute: '/vehicles',
    label: 'Vehicle model', plural: 'Vehicle models', member: 'vehicle', members: 'vehicles', module: 'fleet',
  },
  asset: {
    key: 'asset', modelType: 'asset_model', memberType: 'asset', base: '/api/asset-models', memberPath: '/api/assets', route: '/asset-models', memberRoute: '/assets',
    label: 'Asset model', plural: 'Asset models', member: 'asset', members: 'assets', module: 'assets',
  },
};

interface InheritedFields {
  fields: { field: string; label: string; custom: boolean }[];
  custom: { key: string; name: string; label: string; type: string; inherited: boolean }[];
}

interface Change {
  id: string; kind: 'change' | 'assign'; fields: string[]; status: 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'superseded';
  /** Why a change stopped or was superseded (W19 review). */
  reason?: string | null;
  total: number; applied: number; kept: number; refused: { id: string; label: string; message: string }[];
  created_at: string; finished_at: string | null; created_by_name: string | null;
}

interface Preview {
  members: number; changing: number; keepingTotal: number; background: boolean;
  fields: { field: string; label: string; changes: number; keeps: number }[];
  keeping: { id: string; label: string; fields: string[] }[];
}

type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// One answer per address and version, shared by every note on a page (seven inherited fields would
// otherwise ask seven times).
const cache = new Map<string, Promise<unknown>>();
function cachedGet<T>(url: string, version: string): Promise<T> {
  const key = `${url}#${version}`;
  if (!cache.has(key)) {
    if (cache.size > 50) cache.clear();
    cache.set(key, api.get<T>(url).catch((err) => { cache.delete(key); throw err; }));
  }
  return cache.get(key) as Promise<T>;
}

/** The fields members of a kind inherit (and which custom fields are inherited). */
export function useInheritedFields(kind: ModelKind, enabled = true) {
  return useFetch<InheritedFields>(enabled ? `${kind.base}/inherited-fields` : null);
}

// ---------- on a member's page ----------

/** "From model X", or "Overridden" with "Use the model's value", after an inherited field's value (E39-02). */
export function ModelNote({ kind, row, field }: { kind: ModelKind; row: Row; field: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const modelId = row.model_id as string | null;
  const [info, setInfo] = useState<{ model: Row; fields: string[]; labels: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!modelId) { setInfo(null); return undefined; }
    let live = true;
    const version = String(row.updated_at ?? '');
    Promise.all([cachedGet<Row>(`${kind.base}/${modelId}`, version), cachedGet<InheritedFields>(`${kind.base}/inherited-fields`, '')])
      .then(([model, inherited]) => { if (live) setInfo({ model, fields: inherited.fields.map((f) => f.field), labels: Object.fromEntries(inherited.fields.map((f) => [f.field, f.label])) }); })
      .catch(() => { if (live) setInfo(null); });
    return () => { live = false; };
  }, [kind.base, modelId, row.updated_at]);
  if (!modelId || !info || !info.fields.includes(field)) return null;
  const overrides = Array.isArray(row.model_overrides) ? (row.model_overrides as string[]) : [];
  const modelValue = field.startsWith('cf_') ? (info.model.inherited_custom as Row | undefined)?.[field.slice(3)] : info.model[field];
  if (overrides.includes(field)) {
    const useModel = async () => {
      setBusy(true);
      try {
        await api.patch(`${kind.memberPath}/${row.id}`, { model_overrides: overrides.filter((f) => f !== field) });
        window.dispatchEvent(new CustomEvent('grc:record-changed', { detail: { recordType: kind.memberType, recordId: row.id } }));
        toast.success('The model\'s value is used again.');
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    };
    return (
      <span className="mdl-note">
        <Badge color="amber">Overridden</Badge>
        {can(`${kind.module}.edit`) && !blank(modelValue) && (
          <Button size="sm" variant="ghost" loading={busy} onClick={useModel} aria-label={`Use the model's value for ${(info.labels[field] ?? field).toLowerCase()}`}>Use the model&apos;s value</Button>
        )}
      </span>
    );
  }
  if (blank(modelValue)) return null;
  // The model itself is linked from the member's model field: the note only says where the value comes from.
  return <span className="mdl-note mdl-from" title={`From model ${String(info.model.name)}`}>From model</span>;
}

/** For a member page's summary: the annotate function of RecordPage or EditableSummary. */
export const modelAnnotate = (kind: ModelKind) => (row: Row, field: string): ReactNode => <ModelNote kind={kind} row={row} field={field} />;

/**
 * "New vehicle from this model": the list's address carries `model=<id>`; the New form opens filled
 * with the model's values (E39-05). `pending` while the model loads.
 */
export function useFromModel(kind: ModelKind): { pending: boolean; initial?: Values } {
  const [params] = useSearchParams();
  const id = params.get('model');
  const { data, error } = useFetch<Row>(id ? `${kind.base}/${id}` : null);
  const inherited = useInheritedFields(kind, Boolean(id));
  if (!id) return { pending: false };
  if (error || inherited.error) return { pending: false };
  if (!data || !inherited.data) return { pending: true };
  const initial: Values = { model_id: data.id, _display: { ...(data._display ?? {}), model_id: data.name } };
  for (const f of inherited.data.fields) {
    const v = f.custom ? (data.inherited_custom as Row | undefined)?.[f.field.slice(3)] : data[f.field];
    if (!blank(v)) initial[f.field] = f.field === 'model_year' ? String(v) : v;
  }
  return { pending: false, initial };
}

// ---------- the model's own pages ----------

/** Existing members with no model that match a model by make and model name (E39-05). */
function Suggestions({ kind }: { kind: ModelKind }) {
  const { can } = useAuth();
  const { data } = useFetch<{ model_id: string; name: string; count: number; ids: string[] }[]>(`${kind.base}/suggestions`);
  const [open, setOpen] = useState<{ model_id: string; name: string; ids: string[] } | null>(null);
  if (!data?.length || !can(`${kind.module}.edit`)) return null;
  return (
    <>
      <Notice tone="info" title={`${plural(data.reduce((n, s) => n + s.count, 0), kind.member, kind.members)} with no model match a model`}>
        <ul className="mdl-suggestions">
          {data.slice(0, 5).map((s) => (
            <li key={s.model_id}>
              <span>{plural(s.count, kind.member, kind.members)} match <Link to={`${kind.route}/${s.model_id}`}>{s.name}</Link> by make and model{kind.key === 'vehicle' ? ' (and year)' : ''}.</span>
              <Button size="sm" onClick={() => setOpen(s)}>Review and assign</Button>
            </li>
          ))}
        </ul>
      </Notice>
      {open && <AssignDialog kind={kind} ids={open.ids} modelId={open.model_id} modelName={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Which custom fields of members are inherited from the model (administrators, E39-06). */
function InheritedCustomDialog({ kind, onClose }: { kind: ModelKind; onClose: () => void }) {
  const toast = useToast();
  const { data, error } = useInheritedFields(kind);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const current = chosen ?? data?.custom.filter((f) => f.inherited).map((f) => f.key) ?? [];
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`${kind.base}/inherited-fields`, { custom: current });
      cache.clear();
      toast.success('Inherited custom fields saved.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Custom fields inherited from the model" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!data} onClick={save}>Save</Button></>}>
      {error ? <ErrorState error={error} /> : !data ? <Loading lines={3} /> : data.custom.length === 0 ? (
        <p className="muted">There are no custom fields on {kind.members}. Add them under Administration &gt; Custom fields, then mark them here.</p>
      ) : (
        <div className="stack">
          <p className="muted">A marked field appears on every {kind.label.toLowerCase()} and is inherited like the built-in fields: {kind.members} take the model&apos;s value unless they keep their own.</p>
          {data.custom.map((f) => (
            <Checkbox key={f.key} label={f.label} checked={current.includes(f.key)}
              onChange={(on) => setChosen(on ? [...current, f.key] : current.filter((k) => k !== f.key))} />
          ))}
        </div>
      )}
    </Modal>
  );
}

const LIST_COLUMNS: Record<ModelKindKey, string[]> = {
  vehicle: ['name', 'mode', 'make', 'model', 'model_year', 'capacity', 'active'],
  asset: ['name', 'asset_type', 'make', 'model', 'vendor_id', 'support_end', 'active'],
};
const FORM_FIELDS: Record<ModelKindKey, string[]> = {
  vehicle: ['name', 'mode', 'make', 'model', 'model_year', 'capacity', 'asset_class_id', 'funding_source', 'description', 'active'],
  asset: ['name', 'asset_type', 'make', 'model', 'vendor_id', 'asset_class_id', 'funding_source', 'support_end', 'description', 'active'],
};

/** The list of models, with suggestions for members that match one. `header` goes above it (the fleet's tabs). */
export function ModelList({ kind, header }: { kind: ModelKind; header?: ReactNode }) {
  const resource = useResource(kind.modelType);
  const { can } = useAuth();
  const [custom, setCustom] = useState(false);
  const yearCol = (row: Row) => (row.model_year ? String(row.model_year) : '—');
  return (
    <div className="stack">
      <PageHeader title={kind.plural}
        subtitle={`Shared specifications that ${kind.members} inherit. Change a model and every ${kind.member} using it follows, except values ${kind.key === 'asset' ? 'an' : 'a'} ${kind.member} keeps as its own.`}
        actions={can('admin.administer') && <Button icon="settings" onClick={() => setCustom(true)}>Inherited custom fields</Button>} />
      {header}
      <Suggestions kind={kind} />
      <ResourceList
        type={kind.modelType}
        urlState
        columns={LIST_COLUMNS[kind.key].filter((f) => !resource || resource.fields[f]).map((f) => (f === 'model_year' ? { field: f, label: 'Model year', sortable: true, align: 'right' as const, render: yearCol } : f))}
        filters={['active', ...(kind.key === 'vehicle' ? ['mode'] : ['asset_type', 'vendor_id']), 'funding_source'].filter((f) => !resource || resource.fields[f])}
        createFields={FORM_FIELDS[kind.key]}
        // A new model starts active (the form would otherwise leave the switch off).
        createInitial={{ active: true }}
        bulkFields={['active', 'funding_source']}
      />
      {custom && <InheritedCustomDialog kind={kind} onClose={() => setCustom(false)} />}
    </div>
  );
}

/** Before a model is saved: how many members the change reaches and which keep their own value (E39-03). */
function usePreviewConfirm(kind: ModelKind) {
  const [state, setState] = useState<{ preview: Preview; resolve: (ok: boolean) => void } | null>(null);
  const confirm = async (row: Row, body: Values): Promise<boolean> => {
    const preview = await api.post<Preview>(`${kind.base}/${row.id}/preview`, { changes: body });
    if (!preview.changing && !preview.keepingTotal) return true;
    return new Promise<boolean>((resolve) => setState({ preview, resolve }));
  };
  const answer = (ok: boolean) => { state?.resolve(ok); setState(null); };
  const p = state?.preview;
  const dialog = p && (
    <Modal open title={`Apply this change to the ${kind.members}?`} size="lg" onClose={() => answer(false)}
      footer={<><Button onClick={() => answer(false)}>Cancel</Button><Button variant="primary" onClick={() => answer(true)}>Save and apply</Button></>}>
      <div className="stack">
        <p>
          {plural(p.changing, kind.member, kind.members)} of {plural(p.members, kind.member, kind.members)} using this model take the new values.
          {p.keepingTotal > 0 && ` ${plural(p.keepingTotal, kind.member, kind.members)} keep their own value (an override) and do not change.`}
        </p>
        {p.background && <Notice tone="info">That is many {kind.members}: the change runs in the background. Its progress shows on this page.</Notice>}
        <TableWrap label="What changes">
          <table className="table">
            <caption className="sr-only">What changes, by field</caption>
            <thead><tr><th scope="col">Field</th><th scope="col" className="num">{kind.members[0].toUpperCase() + kind.members.slice(1)} that change</th><th scope="col" className="num">Keep their own value</th></tr></thead>
            <tbody>{p.fields.map((f) => <tr key={f.field}><td>{f.label}</td><td className="num">{f.changes}</td><td className="num">{f.keeps}</td></tr>)}</tbody>
          </table>
        </TableWrap>
        {p.keeping.length > 0 && (
          <details>
            <summary>{kind.members[0].toUpperCase() + kind.members.slice(1)} that keep their own value</summary>
            <ul>{p.keeping.map((k) => <li key={k.id}><Link to={`${kind.memberRoute}/${k.id}`}>{k.label}</Link>: {k.fields.join(', ')}</li>)}</ul>
          </details>
        )}
      </div>
    </Modal>
  );
  return { confirm, dialog };
}

/** The latest change of a model: progress while a background change runs, and members that refused it. */
function ChangeBanner({ kind, modelId, version }: { kind: ModelKind; modelId: string; version: string }) {
  const { data, reload } = useFetch<{ changes: Change[] }>(`${kind.base}/${modelId}/summary?v=${encodeURIComponent(version)}`);
  const latest = data?.changes[0];
  const running = latest && (latest.status === 'queued' || latest.status === 'running');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!running) return undefined;
    timer.current = window.setTimeout(reload, 2000);
    return () => window.clearTimeout(timer.current);
  }, [running, data, reload]);
  if (!latest) return null;
  if (running) {
    return (
      <Notice tone="info" title={`Applying the change to ${plural(latest.total, kind.member, kind.members)}`}>
        <ProgressBar label="Members updated" value={latest.applied + latest.refused.length} max={Math.max(1, latest.total)}
          valueText={`${latest.applied + latest.refused.length} of ${latest.total}`} />
      </Notice>
    );
  }
  const recent = Date.now() - Date.parse(latest.created_at) < 24 * 3600 * 1000;
  if (recent && (latest.status === 'stopped' || latest.status === 'failed')) {
    return (
      <Notice tone="warning" title={`The last change reached ${latest.applied} of ${plural(latest.total, kind.member, kind.members)}`}>
        <p>{latest.reason ?? 'The change stopped before it was finished.'}</p>
      </Notice>
    );
  }
  if (!recent || !latest.refused.length) return null;
  return (
    <Notice tone="warning" title={`${plural(latest.refused.length, kind.member, kind.members)} did not take the last change`}>
      <p>Their own rules refused the new value, so they were left as they were. Change them one by one, or keep their value as an override.</p>
      <ul>{latest.refused.slice(0, 10).map((r) => <li key={r.id}><Link to={`${kind.memberRoute}/${r.id}`}>{r.label}</Link>: {r.message}</li>)}</ul>
    </Notice>
  );
}

/** Values of the inherited custom fields on the model (E39-06). */
function InheritedCustomCard({ kind, row, save, canEdit }: { kind: ModelKind; row: Row; save: (body: Values) => Promise<void>; canEdit: boolean }) {
  const { data } = useInheritedFields(kind);
  const member = useResource(kind.memberType);
  const [editing, setEditing] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = (data?.custom ?? []).filter((f) => f.inherited && member?.fields[f.name]);
  if (!fields.length || !member) return null;
  const values = (row.inherited_custom ?? {}) as Row;
  const shown: Row = { ...row, ...Object.fromEntries(fields.map((f) => [f.name, values[f.key] ?? null])), _display: {} };
  return (
    <Card title="Inherited custom fields" actions={canEdit && !editing && <Button size="sm" icon="edit" onClick={() => setEditing({ ...shown })}>Edit</Button>}>
      {editing ? (
        <div className="stack">
          {fields.map((f) => (
            <FieldControl key={f.name} meta={member.fields[f.name]} value={editing[f.name]} onChange={(v) => setEditing({ ...editing, [f.name]: v })} />
          ))}
          <div className="row">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={async () => {
              setBusy(true);
              try { await save(Object.fromEntries(fields.map((f) => [f.name, editing[f.name] ?? null]))); setEditing(null); } finally { setBusy(false); }
            }}>Save</Button>
          </div>
        </div>
      ) : (
        <dl className="rc-deflist">
          {fields.map((f) => (
            <div key={f.name} className="rc-def"><dt>{f.label}</dt><dd><FieldValue resource={member} field={f.name} row={shown} /></dd></div>
          ))}
        </dl>
      )}
    </Card>
  );
}

/** The Members tab: counts by status, fields members keep as their own, and the members themselves. */
function MembersTab({ kind, model }: { kind: ModelKind; model: Row }) {
  const { data } = useFetch<{ members: number; by_status: { value: string | null; label: string; color: string; count: number }[]; overridden: { field: string; label: string; count: number }[] }>(
    `${kind.base}/${model.id}/summary?v=${encodeURIComponent(String(model.updated_at ?? ''))}`);
  const columns = kind.key === 'vehicle'
    ? ['fleet_number', 'status', 'depot_id', { field: 'model_year', label: 'Model year', render: (r: Row) => (r.model_year ? String(r.model_year) : '—') }, { field: 'capacity', priority: 3 as const }]
    : ['tag', 'name', 'status', 'site_id', { field: 'serial', priority: 3 as const }];
  return (
    <div className="stack">
      {data && (
        <div className="mdl-counts" aria-label={`${kind.members} by status`}>
          <strong>{plural(data.members, kind.member, kind.members)}</strong>
          {data.by_status.map((s) => <StatusChip key={s.value ?? 'none'} color={s.color as ColorName} label={`${s.label}: ${s.count}`} />)}
          {data.overridden.length > 0 && (
            <span className="muted">Kept as their own: {data.overridden.map((o) => `${o.label} (${o.count})`).join(', ')}</span>
          )}
        </div>
      )}
      <ResourceList type={kind.memberType} baseFilter={{ model_id: model.id }} columns={columns} urlState={false} pageSize={25} bulkFields={[]} />
    </div>
  );
}

function ChangesTab({ kind, model }: { kind: ModelKind; model: Row }) {
  const { data, error, reload } = useFetch<Change[]>(`${kind.base}/${model.id}/changes?v=${encodeURIComponent(String(model.updated_at ?? ''))}`);
  const inherited = useInheritedFields(kind);
  const label = (f: string) => inherited.data?.fields.find((x) => x.field === f)?.label ?? f;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.length) return <EmptyState icon="history" title="No changes yet" message={`Changes to this model's shared values, and ${kind.members} given this model, are listed here.`} />;
  return (
    <TableWrap label="Changes applied to the members">
      <table className="table">
        <caption className="sr-only">Changes applied to the members</caption>
        <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col" className="num">Changed</th><th scope="col" className="num">Kept their own</th><th scope="col">Refused</th></tr></thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id}>
              <td>{formatDateTime(c.created_at)}{c.created_by_name && <div className="muted">{c.created_by_name}</div>}</td>
              <td>{c.kind === 'assign' ? `Given to ${kind.members}${c.fields.length ? `, keeping ${c.fields.map(label).join(', ')}` : ''}` : c.fields.map(label).join(', ')}
                {c.status !== 'done' && <div><Badge color={c.status === 'failed' ? 'red' : c.status === 'stopped' ? 'orange' : c.status === 'superseded' ? 'gray' : 'blue'}>
                  {c.status === 'failed' ? 'Failed' : c.status === 'stopped' ? 'Stopped' : c.status === 'superseded' ? 'Replaced by a newer change' : c.status === 'queued' ? 'Waiting' : 'Running'}</Badge></div>}
                {c.reason && (c.status === 'stopped' || c.status === 'failed') && <div className="muted">{c.reason}</div>}</td>
              <td className="num">{c.applied} of {c.total}</td>
              <td className="num">{c.kept}</td>
              <td>{c.refused.length ? (
                <details><summary>{c.refused.length}</summary><ul>{c.refused.map((r) => <li key={r.id}><Link to={`${kind.memberRoute}/${r.id}`}>{r.label}</Link>: {r.message}</li>)}</ul></details>
              ) : <span className="muted">None</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** One model's page. `extraTabs` come after Members (the vehicle model's Equipment). */
export function ModelDetail({ kind, extraTabs = [] }: { kind: ModelKind; extraTabs?: RecordTab[] }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const preview = usePreviewConfirm(kind);
  const resource = useResource(kind.modelType);
  const fields = FORM_FIELDS[kind.key].filter((f) => !resource || resource.fields[f]);
  return (
    <>
      <RecordPage
        type={kind.modelType}
        summaryFields={fields}
        status={(row) => (row.active === false ? <Badge color="gray">Inactive</Badge> : <Badge color="green">Active</Badge>)}
        confirmSave={preview.confirm}
        actions={({ row }) => (row.active !== false && can(`${kind.module}.create`)
          ? <Button variant="primary" icon="plus" onClick={() => navigate(`${kind.memberRoute}?new=1&model=${row.id}`)}>New {kind.member} from this model</Button>
          : null)}
        banner={({ row }) => (
          <>
            <ChangeBanner kind={kind} modelId={row.id} version={String(row.updated_at ?? '')} />
            <InheritedCustomCard kind={kind} row={row} canEdit={can(`${kind.module}.edit`)} save={async (body) => {
              if (!(await preview.confirm(row, body))) return;
              try {
                await api.patch(`${kind.base}/${row.id}`, body);
                toast.success('Changes saved.');
                window.dispatchEvent(new CustomEvent('grc:record-changed', { detail: { recordType: kind.modelType, recordId: row.id } }));
              } catch (err) { toast.error(errorMessage(err)); }
            }} />
          </>
        )}
        tabs={[
          { key: 'members', label: kind.members[0].toUpperCase() + kind.members.slice(1), content: ({ row }) => <MembersTab kind={kind} model={row} /> },
          ...extraTabs,
          { key: 'changes', label: 'Model changes', content: ({ row }) => <ChangesTab kind={kind} model={row} /> },
        ]}
      />
      {preview.dialog}
    </>
  );
}

// ---------- giving many records a model (E39-05) ----------

interface AssignPreview {
  selected: number; already: number; from_other_model: number; inactive: boolean;
  fields: { field: string; label: string; differ: number; examples: { id: string; label: string; value: unknown }[] }[];
}

/** Choose a model (unless given), see which values differ, choose which to keep, and assign. */
export function AssignDialog({ kind, ids, modelId: givenId, modelName, onClose, onDone }: {
  kind: ModelKind; ids: string[]; modelId?: string; modelName?: string; onClose: () => void; onDone?: () => void;
}) {
  const toast = useToast();
  const [modelId, setModelId] = useState<string | null>(givenId ?? null);
  const [keep, setKeep] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ applied: number; refused: { id: string; label: string; message: string }[] } | null>(null);
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    setPreview(null);
    setFailed('');
    if (!modelId) return undefined;
    let live = true;
    api.post<AssignPreview>(`${kind.base}/${modelId}/assign/preview`, { ids })
      .then((p) => { if (live) setPreview(p); })
      .catch((err) => { if (live) setFailed(errorMessage(err)); });
    return () => { live = false; };
  }, [kind.base, modelId, ids]);
  const assign = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ applied: number; refused: { id: string; label: string; message: string }[] }>(`${kind.base}/${modelId}/assign`, { ids, keep });
      setResult(res);
      window.dispatchEvent(new CustomEvent('grc:list-changed', { detail: { type: kind.memberType } }));
      if (!res.refused.length) { toast.success(`Model given to ${plural(res.applied, kind.member, kind.members)}.`); onDone?.(); onClose(); }
    } catch (err) {
      setFailed(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const differing = preview?.fields.filter((f) => f.differ > 0) ?? [];
  const joining = preview ? preview.selected - preview.already : 0;
  return (
    <Modal open title={`Set the ${kind.label.toLowerCase()}`} size="lg" onClose={onClose}
      footer={result ? <Button variant="primary" onClick={() => { onDone?.(); onClose(); }}>Close</Button> : (
        <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!preview || joining === 0 || preview.inactive} onClick={assign}>
          {joining ? `Give the model to ${plural(joining, kind.member, kind.members)}` : 'Give the model'}</Button></>
      )}>
      <div className="stack">
        {!givenId && <RecordPicker label={kind.label} type={kind.modelType} value={modelId} onChange={(id) => { setModelId(id); setKeep([]); }} />}
        {givenId && <p>Model: <Link to={`${kind.route}/${givenId}`}>{modelName ?? kind.label}</Link></p>}
        {failed && <Notice tone="error">{failed}</Notice>}
        {result ? (
          <Notice tone={result.refused.length ? 'warning' : 'success'} title={`Model given to ${plural(result.applied, kind.member, kind.members)}`}>
            {result.refused.length > 0 && (<><p>These refused it and were left as they were:</p>
              <ul>{result.refused.map((r) => <li key={r.id}><Link to={`${kind.memberRoute}/${r.id}`}>{r.label}</Link>: {r.message}</li>)}</ul></>)}
          </Notice>
        ) : modelId && !preview && !failed ? <Loading lines={3} label="Comparing values" /> : preview && (
          <>
            <p>
              {plural(preview.selected, kind.member, kind.members)} selected
              {preview.already > 0 && `; ${plural(preview.already, 'already has', 'already have')} this model`}
              {preview.from_other_model > 0 && `; ${plural(preview.from_other_model, kind.member, kind.members)} move from another model`}.
            </p>
            {preview.inactive && <Notice tone="warning">This model is inactive and cannot be given to {kind.members}.</Notice>}
            {joining > 0 && (differing.length === 0
              ? <p className="muted">Their values already match the model&apos;s.</p>
              : (
                <fieldset className="mdl-keep">
                  <legend>Values that differ from the model&apos;s</legend>
                  <p className="muted">They take the model&apos;s value unless you keep their own (then it is kept as an override).</p>
                  {differing.map((f) => (
                    <Checkbox key={f.field} checked={keep.includes(f.field)} onChange={(on) => setKeep(on ? [...keep, f.field] : keep.filter((k) => k !== f.field))}
                      label={`Keep their own ${f.label.toLowerCase()} (${plural(f.differ, 'differs', 'differ')})`}
                      hint={f.examples.map((e) => `${e.label}: ${e.value ?? 'empty'}`).join('; ')} />
                  ))}
                </fieldset>
              ))}
          </>
        )}
      </div>
    </Modal>
  );
}

/** The bulk bar's "Set model" button on the vehicle and asset lists. */
export function SetModelAction({ kind, rows, clear }: { kind: ModelKind; rows: Row[]; clear: () => void }) {
  const [open, setOpen] = useState(false);
  const ids = rows.map((r) => String(r.id));
  return (
    <>
      <Button size="sm" icon="edit" disabled={!ids.length} onClick={() => setOpen(true)}>Set model</Button>
      {open && <AssignDialog kind={kind} ids={ids} onClose={() => setOpen(false)} onDone={clear} />}
    </>
  );
}
