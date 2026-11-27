// Policy exceptions: time-limited, approved deviations from a policy or standard.
import type { FastifyRequest } from 'fastify';
import { isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readableSql, tablesFor, type AccessTables } from './access.ts';
import { addDays, daysBetween, localDate } from './dates.ts';

const NO_PERMISSION = 'You do not have permission to approve or reject exceptions.';

/** Marks approved exceptions whose expiry date has passed as expired. Returns the rows it changed. */
export async function runExceptionExpiry(ctx: ModuleContext, now: Date = new Date()): Promise<Row[]> {
  const today = localDate(now);
  const due = await ctx.db.query<Row>(
    `select id from policy_exceptions where deleted_at is null and status = 'approved' and expires_on is not null and expires_on < $1::date`,
    [today],
  );
  const out: Row[] = [];
  for (const e of due) out.push(await ctx.resources.update('policy_exception', e.id, { status: 'expired' }));
  return out;
}

export function registerExceptions(ctx: ModuleContext, tables: AccessTables = tablesFor(ctx)) {
  const { db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function checkRefs(req: FastifyRequest | null, merged: Row, changed: Row) {
    if (changed.policy_id && !(await ctx.resources.find('policy', changed.policy_id, req?.user))) invalid({ policy_id: 'Policy not found.' });
    if (changed.risk_id) {
      // The risk register is another module and may not be loaded.
      if (!ctx.resources.get('risk')) invalid({ risk_id: 'The risk register is not available.' });
      if (!(await ctx.resources.find('risk', changed.risk_id, req?.user))) invalid({ risk_id: 'Risk not found.' });
    }
    const datesChanged = changed.approved_on !== undefined || changed.expires_on !== undefined;
    if (datesChanged && merged.approved_on && merged.expires_on && String(merged.expires_on) < String(merged.approved_on)) {
      invalid({ expires_on: 'The expiry date cannot be before the approval date.' });
    }
  }

  /** The rules for moving to `to`. A null `req` is the system (seeding, the daily expiry check). */
  function checkStatus(req: FastifyRequest | null, from: string | null, to: string, merged: Row, patch: Row) {
    // Data load mode (E18-70): a historical exception keeps the status and dates given (an expired
    // or approved one included); no approval date is made up from today.
    if (isDataLoad(req)) return;
    const approver = !req || ctx.can(req.user, 'exceptions.approve');
    if (to === 'approved') {
      if (!approver) ctx.fail(403, 'forbidden', NO_PERMISSION);
      if (!merged.expires_on) invalid({ expires_on: 'Give the date the exception expires before approving it.' });
      if (req && String(merged.expires_on) < localDate()) invalid({ expires_on: 'The expiry date has already passed.' });
      if (!merged.approver_name && req) patch.approver_name = req.user!.displayName;
      if (!merged.approver_name && !req) invalid({ approver_name: 'Name the approver.' });
      if (!merged.approved_on) patch.approved_on = localDate();
    } else if (to === 'rejected') {
      if (!approver) ctx.fail(403, 'forbidden', NO_PERMISSION);
    } else if (to === 'expired' && req) {
      invalid({ status: 'Exceptions are marked expired automatically when their expiry date passes.' });
    } else if (from === 'approved' && req && !approver && to !== 'withdrawn') {
      ctx.fail(403, 'forbidden', NO_PERMISSION);
    }
  }

  ctx.defineResource({
    type: 'policy_exception', table: 'policy_exceptions', module: 'exceptions', label: 'Exception', plural: 'Exceptions',
    path: '/api/exceptions', route: '/exceptions', titleField: 'title', ref: { field: 'ref', prefix: 'EXC-' },
    searchable: ['title', 'description', 'justification', 'compensating_controls', 'approver_name'],
    defaultSort: { field: 'expires_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      policy_id: { label: 'Policy', type: 'ref', to: 'policy' },
      description: { label: 'What is the deviation', type: 'longtext' },
      justification: { label: 'Justification', type: 'longtext' },
      compensating_controls: { label: 'Compensating controls', type: 'longtext' },
      requested_by: { label: 'Requested by', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'exception_status', default: 'requested' },
      approver_name: { label: 'Approver', type: 'text' },
      approver_role: { label: 'Approver role', type: 'text' },
      approved_on: { label: 'Approved on', type: 'date' },
      expires_on: { label: 'Expires on', type: 'date' },
      risk_id: { label: 'Linked risk', type: 'ref', to: 'risk' },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        if (req && !data.requested_by) data.requested_by = req.user!.id;
        await checkRefs(req, data, data);
        if (data.status && data.status !== 'requested') checkStatus(req, null, data.status, data, data);
        return data;
      },
      beforeUpdate: async (req, existing, patch) => {
        const merged = { ...existing, ...patch };
        await checkRefs(req, merged, patch);
        if (patch.status !== undefined && patch.status !== existing.status) {
          checkStatus(req, existing.status, patch.status, merged, patch);
        } else if (existing.status === 'approved' && req) {
          // The approval covers a period and a set of conditions: changing them is an approval decision.
          const guarded = ['expires_on', 'approved_on', 'approver_name', 'approver_role'].filter(
            (k) => patch[k] !== undefined && (patch[k] ?? null) !== (existing[k] ?? null),
          );
          if (guarded.length && !ctx.can(req.user, 'exceptions.approve')) ctx.fail(403, 'forbidden', NO_PERMISSION);
          if (patch.expires_on === null) invalid({ expires_on: 'An approved exception must have an expiry date.' });
        }
        return patch;
      },
    },
  });

  /** Approved exceptions that run out within `days`, and those already past their date. */
  ctx.app.get('/api/exceptions/expiring', { preHandler: ctx.requirePerm('exceptions.view') }, async (req) => {
    const raw = Number((req.query as Row).days);
    const days = Number.isFinite(raw) && raw >= 0 ? Math.min(3650, Math.trunc(raw)) : 30;
    const today = localDate();
    const statuses = new Map((await ctx.lookups.values('exception_status')).map((s) => [s.value, s]));
    const rows = await db.query<Row>(
      `select e.id, e.ref, e.title, e.status, e.policy_id, p.ref as policy_ref, p.title as policy_title, coalesce(${readableSql(req.user, 'p', tables)}, false) as policy_readable,
              e.approver_name, e.approved_on, e.expires_on, u.display_name as requested_by_name
       from policy_exceptions e
       left join policies p on p.id = e.policy_id and p.deleted_at is null
       left join users u on u.id = e.requested_by
       where e.deleted_at is null and e.expires_on is not null and e.status in ('approved', 'expired') and e.expires_on <= $1::date
       order by e.expires_on, e.title`,
      [addDays(today, days)],
    );
    // The policy's name is shown only to people who may read policies.
    const seesPolicies = ctx.can(req.user, 'policies.view');
    return {
      today, days,
      rows: rows.map((r) => ({
        ...r,
        ...(seesPolicies && r.policy_readable ? {} : { policy_ref: null, policy_title: null }),
        policy_readable: undefined,
        status_label: statuses.get(r.status)?.label ?? r.status,
        status_color: statuses.get(r.status)?.color ?? 'gray',
        days_left: daysBetween(today, r.expires_on),
        expired: r.status === 'expired' || r.expires_on < today,
      })),
    };
  });
}
