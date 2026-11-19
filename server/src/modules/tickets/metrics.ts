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
export function registerMetrics(ctx: ModuleContext, sla: { sweep(now?: Date): Promise<number> }) {
  const { db } = ctx;

  ctx.app.get('/api/tickets/metrics', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const now = clock.now();
    await sla.sweep(now);
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
              count(*) filter (where first_responded_at is not null or response_breached)::int as response_measured,
              count(*) filter (where response_breached)::int as response_breached,
              count(*) filter (where resolved_at is not null or resolve_breached)::int as resolve_measured,
              count(*) filter (where resolve_breached)::int as resolve_breached,
              count(*) filter (where response_breached or resolve_breached)::int as breached,
              avg(satisfaction_score) as satisfaction_avg,
              count(satisfaction_score)::int as satisfaction_count,
              avg(extract(epoch from vendor_responded_at - vendor_raised_at) / 60)
                filter (where vendor_raised_at is not null and vendor_responded_at is not null) as vendor_response_avg,
              count(*) filter (where vendor_raised_at is not null and vendor_responded_at is not null)::int as vendor_response_count,
              count(*) filter (where with_vendor)::int as vendor_tickets
       from tickets where ${inRange}`, params))!;

    const opened = await db.query<{ day: string; n: number }>(
      `select (opened_at::date)::text as day, count(*)::int as n from tickets where ${inRange} group by 1`, params);
    const resolvedDays = await db.query<{ day: string; n: number }>(
      `select (resolved_at::date)::text as day, count(*)::int as n from tickets where ${inRange} and resolved_at is not null group by 1`, params);
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

    const grouped = async (column: string, list: string | null) => {
      const rows = await db.query<{ value: string | null; count: number; breached: number }>(
        `select ${column} as value, count(*)::int as count,
                count(*) filter (where response_breached or resolve_breached)::int as breached
         from tickets where ${inRange} group by 1 order by 2 desc, 1`, params);
      const values = list ? await ctx.lookups.values(list) : [];
      return rows.map((r) => {
        const lv = values.find((v) => v.value === r.value);
        return { value: r.value, label: r.value === null || r.value === '' ? 'Not set' : lv?.label ?? r.value, color: lv?.color ?? 'gray', count: r.count, breached: r.breached };
      });
    };

    const openRows = await db.query<{ opened_at: Date }>('select opened_at from tickets where deleted_at is null and resolved_at is null');
    const backlog = AGE_BUCKETS.map(([key, label, min, max]) => ({
      key, label, count: 0,
      // Bounds on opened_at for drilling into the list.
      opened_after: max === null ? null : new Date(now.getTime() - max * DAY_MS).toISOString(),
      opened_before: new Date(now.getTime() - min * DAY_MS).toISOString(),
    }));
    for (const r of openRows) {
      const age = (now.getTime() - new Date(r.opened_at).getTime()) / DAY_MS;
      const i = AGE_BUCKETS.findIndex(([, , min, max]) => age >= min && (max === null || age < max));
      backlog[i < 0 ? 0 : i].count += 1;
    }

    const held = (await db.one<{ n: number }>(
      'select count(*)::int as n from tickets where deleted_at is null and with_vendor and resolved_at is null'))!.n;

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
      backlog: { total: openRows.length, buckets: backlog },
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
