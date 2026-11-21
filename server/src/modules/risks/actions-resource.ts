import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { MASKED_LABEL, MASKED_SQL, MASKED_VALUE } from '../../core/resource.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { makeActionExtras } from './actions.ts';
import { syncCap } from './caps.ts';

// The cross-module action tracker: the `action` record type, its preparation rules and the
// action summary. Moved out of index.ts unchanged (wave 10 step 0); the extras (sharing and
// "assigned to you" notifications) stay in actions.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contract C2: the action status an action that needs verification waits in once its work is finished. Not a closed status. */
export const PENDING_VERIFICATION = 'pending_verification';
/** E23-04: the `action_source` values whose actions need closure evidence (default none). */
export const CLOSURE_EVIDENCE_SETTING = 'actions.closure_evidence_sources';
/** Days after completion a verification falls due when nobody set a date. */
export const VERIFICATION_DAYS = 30;

/**
 * Actions whose effective verification is being recorded right now (POST /api/actions/:id/verify):
 * only that route may move an action that needs verification to a done status.
 */
export const verifiedNow = new Set<string>();

export type ActionExtras = ReturnType<typeof makeActionExtras>;

/** Defines the `action` record type, registers the extras' routes and `/api/actions/summary`. */
export function registerActionResource(ctx: ModuleContext, extras: ActionExtras): void {
  const today = async () => (await ctx.db.one<{ d: string }>('select current_date::text as d'))!.d;
  const statusesWith = async (list: string, flag: string) =>
    (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag]).map((v) => v.value);

  async function prepareAction(req: FastifyRequest | null, existing: Row | null, data: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    // E23-01: an action added to a corrective action plan arose from the plan's source record, so it
    // takes the plan's source (and with it the source's restriction) unless told otherwise, and
    // needs its effectiveness verified unless told otherwise.
    if (data.cap_id && data.cap_id !== existing?.cap_id) {
      const cap = await ctx.resources.find('cap', String(data.cap_id), req?.user ?? null);
      if (!cap) errors.cap_id = 'Choose a corrective action plan you can see.';
      else if (!existing) {
        if (!data.source_type && cap.source_type) { data.source_type = cap.source_type; data.source_id = cap.source_id; }
        if ((data.source === undefined || data.source === null || data.source === '') && cap.source) data.source = cap.source;
        if (data.verification_required === undefined) data.verification_required = true;
      }
    }
    // An action raised on a record files itself under that record's source unless told otherwise.
    if (!existing && (data.source === undefined || data.source === null || data.source === '')) {
      data.source = (data.source_type ? await extras.sourceFor(data.source_type) : undefined) ?? 'other';
    }
    if (data.source_id && !UUID.test(String(data.source_id))) errors.source_id = 'Source record is not a valid reference.';
    if (data.source_type && !/^[a-z_][a-z0-9_]*$/.test(String(data.source_type))) errors.source_type = 'Source record type is not valid.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const merged: Row = { ...(existing ?? {}), ...data };

    // E23-05: once its plan is approved, an action's due date moves through an extension request;
    // people who may approve actions can still change it directly.
    if (req && existing && data.due_on !== undefined && data.due_on !== existing.due_on && existing.due_on && merged.cap_id
      && !ctx.can(req.user ?? null, 'actions.approve') && await capApproved(String(merged.cap_id))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', {
        due_on: 'This action belongs to an approved corrective action plan: ask for an extension instead of changing the due date.',
      });
    }

    if (data.status !== undefined && data.status !== existing?.status) {
      const done = (await statusesWith('action_status', 'done')).includes(data.status);
      const finishing = done || data.status === PENDING_VERIFICATION;
      if (finishing && existing?.status !== PENDING_VERIFICATION) await checkClosureEvidence(existing, merged);
      // E23-03 (contract C2): finishing an action that needs verification makes it wait for the
      // verification instead; only a recorded effective verification makes it done.
      if (done && merged.verification_required === true && !(existing && verifiedNow.has(existing.id))) {
        if (existing?.status === PENDING_VERIFICATION) {
          ctx.fail(409, 'verification_needed', 'This action is waiting for its effectiveness to be verified. Record the verification to finish it.');
        }
        if ((await ctx.lookups.values('action_status')).some((v) => v.value === PENDING_VERIFICATION)) data.status = PENDING_VERIFICATION;
      }
      if (data.status === PENDING_VERIFICATION) {
        if (!data.completed_on && !(existing?.status === PENDING_VERIFICATION)) data.completed_on = await today();
        if (!merged.verification_due) data.verification_due = dayInZone(VERIFICATION_DAYS);
      } else if (done) {
        if (!data.completed_on && !existing?.completed_on) data.completed_on = await today();
      } else if (data.completed_on === undefined && existing?.completed_on) {
        data.completed_on = null;
      }
    }
    return data;
  }

  /** E23-04: actions from the sources named in the setting need evidence before they are finished. */
  async function checkClosureEvidence(existing: Row | null, merged: Row): Promise<void> {
    const setting = await ctx.settings.get<unknown>(CLOSURE_EVIDENCE_SETTING, []);
    const sources = Array.isArray(setting) ? setting.map(String) : [];
    if (!merged.source || !sources.includes(String(merged.source))) return;
    if (String(merged.closure_evidence ?? '').trim()) return;
    // Files live in the attachments module; without it only the text counts.
    if (existing && (await ctx.db.one<{ ok: boolean }>(`select to_regclass('attachments') is not null as ok`))?.ok
      && await ctx.db.one('select 1 from attachments where record_type = $1 and record_id = $2 and deleted_at is null limit 1', ['action', existing.id])) return;
    ctx.fail(400, 'validation', 'Check the highlighted fields.', {
      closure_evidence: 'Actions from this source need closure evidence before they are finished: attach a file or describe the evidence.',
    });
  }

  async function capApproved(capId: string): Promise<boolean> {
    const cap = await ctx.db.one<Row>('select status from caps where id = $1 and deleted_at is null', [capId]);
    return Boolean(cap && !['draft', 'submitted', 'rejected'].includes(String(cap.status ?? 'draft')));
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
      // E23: corrective action plans, verification of effectiveness and due-date extensions.
      cap_id: { label: 'Corrective action plan', type: 'ref', to: 'cap' },
      verification_required: { label: 'Needs verification', type: 'boolean' },
      verifier_id: { label: 'Verifier', type: 'user' },
      verification_due: { label: 'Verification due', type: 'date' },
      verified_by: { label: 'Verified by', type: 'user', readOnly: true },
      verified_on: { label: 'Verified on', type: 'date', readOnly: true },
      verification_method: { label: 'Verification method', type: 'lookup', list: 'verification_method', readOnly: true },
      verification_result: { label: 'Verification result', type: 'lookup', list: 'verification_result', readOnly: true },
      verification_note: { label: 'Verification note', type: 'longtext', readOnly: true },
      closure_evidence: { label: 'Closure evidence', type: 'longtext' },
      original_due_on: { label: 'Original due date', type: 'date', readOnly: true },
      extension_count: { label: 'Extensions', type: 'number', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => prepareAction(req, null, data),
      beforeUpdate: (req, existing, patch) => prepareAction(req, existing, patch),
      afterCreate: async (req, row) => {
        await extras.notifyAssigned(req, row);
        if (row.cap_id) await syncCap(ctx, String(row.cap_id));
      },
      afterUpdate: async (req, before, after) => {
        if (after.owner_id && after.owner_id !== before.owner_id) await extras.notifyAssigned(req, after);
        // A plan follows its actions: in progress, verifying, closed, or back in progress on a reopen.
        if (before.cap_id && before.cap_id !== after.cap_id) await syncCap(ctx, String(before.cap_id));
        if (after.cap_id && (after.status !== before.status || after.cap_id !== before.cap_id)) await syncCap(ctx, String(after.cap_id));
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
              count(*) filter (where due_on < current_date and completed_on is null)::int as overdue,
              count(*) filter (where status = 'pending_verification')::int as awaiting_verification,
              count(*) filter (where due_on >= current_date and due_on <= current_date + (7 - extract(isodow from current_date))::int)::int as due_this_week,
              count(*) filter (where owner_id is null)::int as unassigned,
              current_date::text as today,
              (current_date + (7 - extract(isodow from current_date))::int)::text as week_end
       from actions where ${open}`, [closed]))!;
    const group = (expr: string) => ctx.db.query<Row>(
      `select ${expr} as value, count(*)::int as open, count(*) filter (where due_on < current_date and completed_on is null)::int as overdue
       from actions where ${open} group by 1 order by 2 desc, 1`, [closed]);
    const owners = await group(masked('owner_id::text'));
    const names = new Map((await ctx.db.query<Row>(
      'select id::text as id, display_name from users where id::text = any($1::text[])', [owners.map((o) => o.value).filter((v) => v && v !== MASKED_VALUE)],
    )).map((u) => [u.id, u.display_name]));
    const sources = await ctx.lookups.values('action_source');
    const mine = (await ctx.db.one<Row>(
      `select count(*)::int as open, count(*) filter (where due_on < current_date and completed_on is null)::int as overdue,
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
