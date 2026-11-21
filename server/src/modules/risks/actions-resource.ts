import type { ModuleContext, Row } from '../../core/module.ts';
import { MASKED_LABEL, MASKED_SQL, MASKED_VALUE } from '../../core/resource.ts';
import type { makeActionExtras } from './actions.ts';

// The cross-module action tracker: the `action` record type, its preparation rules and the
// action summary. Moved out of index.ts unchanged (wave 10 step 0); the extras (sharing and
// "assigned to you" notifications) stay in actions.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionExtras = ReturnType<typeof makeActionExtras>;

/** Defines the `action` record type, registers the extras' routes and `/api/actions/summary`. */
export function registerActionResource(ctx: ModuleContext, extras: ActionExtras): void {
  const today = async () => (await ctx.db.one<{ d: string }>('select current_date::text as d'))!.d;
  const statusesWith = async (list: string, flag: string) =>
    (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag]).map((v) => v.value);

  async function prepareAction(existing: Row | null, data: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    // An action raised on a record files itself under that record's source unless told otherwise.
    if (!existing && (data.source === undefined || data.source === null || data.source === '')) {
      data.source = (data.source_type ? await extras.sourceFor(data.source_type) : undefined) ?? 'other';
    }
    if (data.source_id && !UUID.test(String(data.source_id))) errors.source_id = 'Source record is not a valid reference.';
    if (data.source_type && !/^[a-z_][a-z0-9_]*$/.test(String(data.source_type))) errors.source_type = 'Source record type is not valid.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (data.status !== undefined && data.status !== existing?.status) {
      const done = (await statusesWith('action_status', 'done')).includes(data.status);
      if (done && !data.completed_on) data.completed_on = await today();
      if (!done && data.completed_on === undefined && existing?.completed_on) data.completed_on = null;
    }
    return data;
  }

  ctx.defineResource({
    type: 'action', table: 'actions', module: 'actions', label: 'Action', plural: 'Actions',
    path: '/api/actions', route: '/actions', titleField: 'title', ref: { field: 'ref', prefix: 'ACT-' },
    // An action raised on a restricted record (a risk, a security incident, anything flagged) is
    // itself restricted: core copies the flag from the source record and keeps it in step.
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
    searchable: ['title', 'description', 'notes', 'department', 'external_ref'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      status: { label: 'Status', type: 'lookup', list: 'action_status', default: 'open' },
      priority: { label: 'Priority', type: 'lookup', list: 'action_priority', default: 'medium' },
      owner_id: { label: 'Owner', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      completed_on: { label: 'Completed', type: 'date' },
      // No fixed default: prepareAction files a new action under its source record's kind, else "other".
      source: { label: 'Source', type: 'lookup', list: 'action_source' },
      source_type: { label: 'Source record type', type: 'text' },
      source_id: { label: 'Source record', type: 'text' },
      external_ref: { label: 'External reference', type: 'text' },
      department: { label: 'Department', type: 'text' },
      notes: { label: 'Notes', type: 'longtext' },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
    },
    hooks: {
      beforeCreate: (_req, data) => prepareAction(null, data),
      beforeUpdate: (_req, existing, patch) => prepareAction(existing, patch),
      afterCreate: (req, row) => extras.notifyAssigned(req, row),
      afterUpdate: async (req, before, after) => {
        if (after.owner_id && after.owner_id !== before.owner_id) await extras.notifyAssigned(req, after);
      },
    },
  });
  extras.register();

  ctx.app.get('/api/actions/summary', { preHandler: ctx.requirePerm('actions.view') }, async (req) => {
    const closed = await statusesWith('action_status', 'closed');
    // Figures are the same for everyone (docs/security.md, "Figures"): every open action counts,
    // restricted or not. A restricted action's owner and department are its details, so those
    // groups put it under "Restricted records" for everyone. "Mine" is the caller's own figure.
    const open = `deleted_at is null and not (coalesce(status, '') = any($1::text[]))`;
    const masked = (col: string) => `case when coalesce(restricted, false) and ${col} is not null then ${MASKED_SQL} else ${col} end`;
    const head = (await ctx.db.one<Row>(
      `select count(*)::int as open,
              count(*) filter (where due_on < current_date)::int as overdue,
              count(*) filter (where due_on >= current_date and due_on <= current_date + (7 - extract(isodow from current_date))::int)::int as due_this_week,
              count(*) filter (where owner_id is null)::int as unassigned,
              current_date::text as today,
              (current_date + (7 - extract(isodow from current_date))::int)::text as week_end
       from actions where ${open}`, [closed]))!;
    const group = (expr: string) => ctx.db.query<Row>(
      `select ${expr} as value, count(*)::int as open, count(*) filter (where due_on < current_date)::int as overdue
       from actions where ${open} group by 1 order by 2 desc, 1`, [closed]);
    const owners = await group(masked('owner_id::text'));
    const names = new Map((await ctx.db.query<Row>(
      'select id::text as id, display_name from users where id::text = any($1::text[])', [owners.map((o) => o.value).filter((v) => v && v !== MASKED_VALUE)],
    )).map((u) => [u.id, u.display_name]));
    const sources = await ctx.lookups.values('action_source');
    const mine = (await ctx.db.one<Row>(
      `select count(*)::int as open, count(*) filter (where due_on < current_date)::int as overdue,
              count(*) filter (where due_on >= current_date and due_on <= current_date + (7 - extract(isodow from current_date))::int)::int as due_this_week
       from actions where ${open} and owner_id = $2 and ${ctx.resources.visibleWhere('action', req.user)}`, [closed, req.user!.id]))!;
    return {
      ...head,
      mine,
      open_statuses: (await ctx.lookups.values('action_status')).filter((v) => !v.meta?.closed).map((v) => v.value),
      by_owner: owners.map((o) => (o.value === MASKED_VALUE
        ? { owner_id: null, restricted: true, label: MASKED_LABEL, open: o.open, overdue: o.overdue }
        : { owner_id: o.value, label: o.value ? names.get(o.value) ?? 'Unknown user' : 'Unassigned', open: o.open, overdue: o.overdue })),
      by_source: (await group('source')).map((s) => {
        const lv = sources.find((x) => x.value === s.value);
        return { value: s.value, label: lv?.label ?? s.value ?? 'None', color: lv?.color ?? 'gray', open: s.open, overdue: s.overdue };
      }),
      by_department: (await group(masked(`nullif(department, '')`))).map((d) => (d.value === MASKED_VALUE
        ? { value: null, restricted: true, label: MASKED_LABEL, open: d.open, overdue: d.overdue }
        : { value: d.value, label: d.value ?? 'None', open: d.open, overdue: d.overdue })),
    };
  });
}
