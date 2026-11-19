import type { ModuleContext, Row } from '../../core/module.ts';
import { clock } from './clock.ts';

const DAY_MS = 86_400_000;

/** Backlog age bands in whole days: [key, label, from (inclusive), to (exclusive)]. */
export const AGE_BUCKETS: [string, string, number, number | null][] = [
  ['d0', 'Under 1 day', 0, 1],
  ['d1', '1 to 3 days', 1, 3],
  ['d3', '3 to 7 days', 3, 7],
  ['d7', '7 to 14 days', 7, 14],
  ['d14', 'Over 14 days', 14, null],
];

const round1 = (n: unknown) => (n === null || n === undefined ? null : Math.round(Number(n) * 10) / 10);
const pct = (met: number, measured: number) => (measured ? Math.round((met / measured) * 1000) / 10 : null);

function parseBound(ctx: ModuleContext, name: string, raw: unknown, endOfDay: boolean): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  // A bare date means the whole local day; the database session runs in the organization's time zone.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : s);
  if (Number.isNaN(d.getTime())) ctx.fail(400, 'validation', `"${name}" must be a date or a date and time.`, { [name]: 'Not a valid date.' });
  return d;
}

/**
 * GET /api/tickets/metrics?from=&to=
 * Figures for tickets opened in the range (all time when no range is given). Backlog and
 * vendor-held counts describe the desk as it stands now, so they ignore the range.
 */
export function registerMetrics(ctx: ModuleContext) {
  const { db } = ctx;

  ctx.app.get('/api/tickets/metrics', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const now = clock.now();
    // E18-29: a read never runs the sweep. A target that has passed since the last sweep counts as
    // missed all the same, so the figures do not depend on when the timer last ran.
    const at = `'${now.toISOString()}'::timestamptz`;
    const RB = `(response_breached or (first_responded_at is null and resolved_at is null and paused_at is null and response_due_at < ${at}))`;
    const SB = `(resolve_breached or (resolved_at is null and paused_at is null and resolve_due_at < ${at}))`;
    const from = parseBound(ctx, 'from', q.from, false);
    const to = parseBound(ctx, 'to', q.to, true);
    // Bare dates are read by Postgres in the session time zone, matching the day grouping below.
    const bare = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const params = [
      from ? (bare(q.from) ? `${q.from} 00:00:00` : from.toISOString()) : null,
      to ? (bare(q.to) ? `${q.to} 23:59:59.999` : to.toISOString()) : null,
    ];
    const inRange = `deleted_at is null and ($1::timestamptz is null or opened_at >= $1::timestamptz)
                     and ($2::timestamptz is null or opened_at <= $2::timestamptz)`;

    const totals = (await db.one<Row>(
      `select count(*)::int as total,
              count(*) filter (where resolved_at is null)::int as open,
              count(*) filter (where resolved_at is not null)::int as resolved,
              avg(extract(epoch from first_responded_at - opened_at) / 60) filter (where first_responded_at is not null) as first_response_avg,
              count(*) filter (where first_responded_at is not null)::int as first_response_count,
              avg(extract(epoch from resolved_at - opened_at) / 60) filter (where resolved_at is not null) as resolution_avg,
              count(*) filter (where first_responded_at is not null or ${RB})::int as response_measured,
              count(*) filter (where ${RB})::int as response_breached,
              count(*) filter (where resolved_at is not null or ${SB})::int as resolve_measured,
              count(*) filter (where ${SB})::int as resolve_breached,
              count(*) filter (where ${RB} or ${SB})::int as breached,
              avg(satisfaction_score) as satisfaction_avg,
              count(satisfaction_score)::int as satisfaction_count,
              avg(extract(epoch from vendor_responded_at - vendor_raised_at) / 60)
                filter (where vendor_raised_at is not null and vendor_responded_at is not null) as vendor_response_avg,
              count(*) filter (where vendor_raised_at is not null and vendor_responded_at is not null)::int as vendor_response_count,
              count(*) filter (where with_vendor)::int as vendor_tickets
       from tickets where ${inRange}`, params))!;

    // Every grouping in one pass over the tickets (E16-36): each grouping set is one breakdown,
    // ordered as each separate query was (count, largest first, then the value).
    const GROUPS = ['category', 'requester_department', 'priority', 'status', 'type'] as const;
    const sets = await db.query<Row>(
      `select grouping(category, requester_department, priority, status, type, (opened_at::date), (resolved_at::date)) as g,
              ${GROUPS.join(', ')}, (opened_at::date)::text as opened_day, (resolved_at::date)::text as resolved_day,
              count(*)::int as count, count(*) filter (where ${RB} or ${SB})::int as breached
       from tickets where ${inRange}
       group by grouping sets ((category), (requester_department), (priority), (status), (type), ((opened_at::date)), ((resolved_at::date)))
       order by 1, count(*) desc, ${GROUPS.join(', ')}`, params);
    // grouping() sets a bit for each column NOT in the set, the first column being the highest bit.
    const ALL = 7;
    const inSet = (i: number) => sets.filter((r) => r.g === ((1 << ALL) - 1) - (1 << (ALL - 1 - i)));
    const opened = inSet(5).map((r) => ({ day: r.opened_day as string, n: r.count as number })).filter((r) => r.day !== null);
    const resolvedDays = inSet(6).map((r) => ({ day: r.resolved_day as string, n: r.count as number })).filter((r) => r.day !== null);
    const days = new Map<string, { day: string; opened: number; resolved: number }>();
    const dayRow = (day: string) => {
      let r = days.get(day);
      if (!r) { r = { day, opened: 0, resolved: 0 }; days.set(day, r); }
      return r;
    };
    for (const r of opened) dayRow(r.day).opened = r.n;
    for (const r of resolvedDays) dayRow(r.day).resolved = r.n;
    // Fill the gaps so that the chart shows quiet days as zero.
    const known = [...days.keys()].sort();
    const first = bare(q.from) ? q.from : known[0];
    const last = bare(q.to) ? q.to : known[known.length - 1];
    if (first && last) {
      const end = Date.parse(`${last}T00:00:00Z`);
      for (let t = Date.parse(`${first}T00:00:00Z`), i = 0; t <= end && i < 400; t += DAY_MS, i++) {
        dayRow(new Date(t).toISOString().slice(0, 10));
      }
    }

    const grouped = async (column: typeof GROUPS[number], list: string | null) => {
      const rows = inSet(GROUPS.indexOf(column)).map((r) => ({ value: r[column] as string | null, count: r.count as number, breached: r.breached as number }));
      const values = list ? await ctx.lookups.values(list) : [];
      return rows.map((r) => {
        const lv = values.find((v) => v.value === r.value);
        return { value: r.value, label: r.value === null || r.value === '' ? 'Not set' : lv?.label ?? r.value, color: lv?.color ?? 'gray', count: r.count, breached: r.breached };
      });
    };

    // The backlog by age, and the tickets held by a vendor, counted in the database (E16-36: every open
    // ticket used to be read to be counted here). A ticket whose age is below the first band (opened
    // in the future) counts in the first band; one with no opening time in the last.
    const ageDays = `(extract(epoch from (${at} - opened_at)) * 1000 / ${DAY_MS})`;
    const band = (min: number, max: number | null, i: number) => {
      const conds = [i === 0 ? null : `${ageDays} >= ${min}`, max === null ? null : `${ageDays} < ${max}`].filter(Boolean);
      const cond = conds.length ? conds.join(' and ') : 'true';
      return i === AGE_BUCKETS.length - 1 ? `(opened_at is null or (${cond}))` : `(opened_at is not null and ${cond})`;
    };
    const now_ = (await db.one<Row>(
      `select count(*)::int as open_total,
              count(*) filter (where with_vendor)::int as held,
              ${AGE_BUCKETS.map(([, , min, max], i) => `count(*) filter (where ${band(min, max, i)})::int as b${i}`).join(', ')}
       from tickets where deleted_at is null and resolved_at is null`))!;
    const backlog = AGE_BUCKETS.map(([key, label, min, max], i) => ({
      key, label, count: now_[`b${i}`] as number,
      // Bounds on opened_at for drilling into the list.
      opened_after: max === null ? null : new Date(now.getTime() - max * DAY_MS).toISOString(),
      opened_before: new Date(now.getTime() - min * DAY_MS).toISOString(),
    }));
    const held = now_.held as number;

    return {
      range: { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null },
      as_of: now.toISOString(),
      total: totals.total,
      open: totals.open,
      resolved: totals.resolved,
      volume_by_day: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
      by_category: await grouped('category', 'ticket_category'),
      by_department: await grouped('requester_department', null),
      by_priority: await grouped('priority', 'ticket_priority'),
      by_status: await grouped('status', 'ticket_status'),
      by_type: await grouped('type', 'ticket_type'),
      backlog: { total: now_.open_total as number, buckets: backlog },
      first_response: { average_minutes: round1(totals.first_response_avg), count: totals.first_response_count },
      resolution: { average_minutes: round1(totals.resolution_avg), count: totals.resolved },
      sla: {
        response: { measured: totals.response_measured, breached: totals.response_breached, compliance_pct: pct(totals.response_measured - totals.response_breached, totals.response_measured) },
        resolve: { measured: totals.resolve_measured, breached: totals.resolve_breached, compliance_pct: pct(totals.resolve_measured - totals.resolve_breached, totals.resolve_measured) },
        /** Share of tickets in the range with no missed target of either kind. */
        compliance_pct: pct(totals.total - totals.breached, totals.total),
        breaches: totals.breached,
      },
      satisfaction: { average: totals.satisfaction_avg === null ? null : Math.round(Number(totals.satisfaction_avg) * 100) / 100, count: totals.satisfaction_count },
      vendor: {
        held: held,
        tickets: totals.vendor_tickets,
        average_response_minutes: round1(totals.vendor_response_avg),
        responses: totals.vendor_response_count,
      },
    };
  });
}
