import { z } from 'zod';
import { qs, ToolError } from './caller.ts';
import { fail, isUuid, plural, presentRow, type ToolSpec, type TypeMeta } from './toolkit.ts';

// Vehicle and asset models (E39-07): a model, what its members inherit, and the members themselves.
// Reading a model's fields alone is the generic get_record (types vehicle_model and asset_model).

const KINDS = {
  vehicle: { modelType: 'vehicle_model', memberType: 'vehicle', member: 'vehicle', members: 'vehicles', fields: ['fleet_number', 'status', 'depot_id', 'model_year'] },
  asset: { modelType: 'asset_model', memberType: 'asset', member: 'asset', members: 'assets', fields: ['status', 'asset_type', 'site_id', 'serial'] },
} as const;

/** One tool per kind, so the vehicle one (and its wording) is gone while Fleet and services is off. */
const modelMembers = (kind: 'vehicle' | 'asset'): ToolSpec => ({
  name: `${kind}_model_members`, title: kind === 'vehicle' ? 'Vehicle model and its vehicles' : 'Asset model and its assets', group: 'Records', idempotent: true,
  description: `One ${kind} model: the shared values its ${kind}s inherit, how many ${kind}s use it by status, `
    + `which inherited fields some ${kind}s keep as their own (overrides), recent changes applied to them, and the first ${kind}s.`,
  available: (a) => (kind === 'vehicle' ? a.can('fleet.view') && a.sees('vehicle_model') : a.can('assets.view') && a.sees('asset_model')),
  input: {
    model: z.string().min(1).describe('The model\'s id or its name (or part of it).'),
    limit: z.number().int().min(1).max(100).optional().describe(`How many ${kind}s to list (default 25).`),
  },
  async run(args, t) {
    const k = KINDS[kind];
    const meta = await t.meta();
    const modelType = meta.resources[k.modelType] as TypeMeta | undefined;
    const memberType = meta.resources[k.memberType] as TypeMeta | undefined;
    if (!modelType || !memberType) fail(`${kind === 'vehicle' ? 'Vehicle' : 'Asset'} models are not available to you here.`, 'unknown_type');
    const key = String(args.model).trim();
    let model: any;
    if (isUuid(key)) model = await t.api.get(`${modelType!.path}/${key}`);
    else {
      const found = await t.api.get<{ rows: any[] }>(`${modelType!.path}${qs({ q: key, pageSize: 10 })}`);
      model = found.rows.find((r) => String(r.name).toLowerCase() === key.toLowerCase()) ?? found.rows[0];
      if (!model) throw new ToolError(`No ${modelType!.label.toLowerCase()} called "${key}" that you can see.`, 'not_found', 404);
    }
    const summary = await t.api.get<any>(`${modelType!.path}/${model.id}/summary`);
    const inherited = await t.api.get<any>(`${modelType!.path}/inherited-fields`);
    const members = await t.api.get<{ rows: any[]; total: number }>(`${memberType!.path}${qs({ 'f.model_id': model.id, pageSize: args.limit ?? 25 })}`);
    const shared = Object.fromEntries((inherited.fields as { field: string; label: string; custom: boolean }[]).map((f) => {
      const v = f.custom ? model.inherited_custom?.[f.field.slice(3)] : model._display?.[f.field] ?? model[f.field];
      return [f.label, v ?? null];
    }));
    const rows: (Record<string, unknown> & { title?: unknown; overrides: string[] })[] = members.rows.map((r) => ({
      ...presentRow(t, memberType!, r, k.fields.filter((f) => memberType!.fields[f])),
      overrides: (Array.isArray(r.model_overrides) ? r.model_overrides : []).map((f: string) => memberType!.fields[f]?.label ?? f),
    }));
    const statusLine = (summary.by_status as { label: string; count: number }[]).map((s) => `${s.label} ${s.count}`).join(', ');
    const overrideLine = (summary.overridden as { label: string; count: number }[]).map((o) => `${o.label} (${o.count})`).join(', ');
    return {
      text: `${modelType!.label} ${model.name}${model.active === false ? ' (inactive)' : ''}: ${plural(summary.members, k.member, k.members)}${statusLine ? ` (${statusLine})` : ''}.\n`
        + `Shared values: ${Object.entries(shared).filter(([, v]) => v !== null && v !== '').map(([l, v]) => `${l} ${v}`).join('; ') || 'none set'}.\n`
        + (overrideLine ? `Kept as their own by some members: ${overrideLine}.\n` : '')
        + rows.slice(0, 20).map((r) => `- ${r.title}${r.overrides.length ? ` (keeps its own ${r.overrides.join(', ')})` : ''}`).join('\n'),
      data: {
        model: { id: model.id, name: model.name, active: model.active !== false, url: t.link(modelType!.route, model.id), shared },
        members: summary.members, by_status: summary.by_status, overridden: summary.overridden, recent_changes: summary.changes,
        listed: rows, url: t.link(modelType!.route, model.id),
      },
    };
  },
});

export const MODEL_TOOLS: ToolSpec[] = [modelMembers('vehicle'), modelMembers('asset')];
