import type { ModuleContext, Row } from '../../core/module.ts';
import { secured } from './policy.ts';

/** Dashboard numbers and the weekly trend snapshots behind them. */

export const AGE_BUCKETS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: '0-15', label: '0-15 days', min: 0, max: 15 },
  { key: '16-30', label: '16-30 days', min: 16, max: 30 },
  { key: '31-90', label: '31-90 days', min: 31, max: 90 },
  { key: '91-180', label: '91-180 days', min: 91, max: 180 },
  { key: '180+', label: 'Over 180 days', min: 181, max: null },
];
const TREND_WEEKS = 12;
const OPEN = 'deleted_at is null and not closed';

/** Records this week's open and overdue counts per severity (one row per severity, replaced during the week). */
export async function takeSnapshot(ctx: ModuleContext): Promise<void> {
  const severities = (await ctx.lookups.values('vulnerability_severity')).map((s) => s.value);
  const counts = await ctx.db.query<{ severity: string; open: number; overdue: number }>(
    `select severity, count(*)::int as open,
            count(*) filter (where due_on is not null and due_on < current_date)::int as overdue
     from vulnerabilities where ${OPEN} group by 1`,
  );
  for (const severity of new Set([...severities, ...counts.map((c) => c.severity)])) {
    const c = counts.find((x) => x.severity === severity);
    await ctx.db.query(
      `insert into vulnerability_snapshots (week_start, severity, open_count, overdue_count)
       values (date_trunc('week', current_date)::date, $1, $2, $3)
       on conflict (week_start, severity) do update
         set open_count = excluded.open_count, overdue_count = excluded.overdue_count, taken_at = now()`,
      [severity, c?.open ?? 0, c?.overdue ?? 0],
    );
  }
}

export async function buildSummary(ctx: ModuleContext) {
  const { db } = ctx;
  const severities = (await ctx.lookups.values('vulnerability_severity')).map((s) => ({ value: s.value, label: s.label, color: s.color ?? 'gray' }));
  const zero = () => Object.fromEntries(severities.map((s) => [s.value, 0])) as Record<string, number>;

  const open = await db.query<Row>(
    `select severity, count(*)::int as open,
            count(*) filter (where due_on is not null and due_on < current_date)::int as overdue,
            count(*) filter (where known_exploited)::int as exploited,
            count(*) filter (where owner_id is null)::int as unassigned
     from vulnerabilities where ${OPEN} group by 1`,
  );
  const openBy = zero();
  const overdueBy = zero();
  let knownExploitedOpen = 0;
  let unassignedOpen = 0;
  for (const r of open) {
    openBy[r.severity] = (openBy[r.severity] ?? 0) + r.open;
    overdueBy[r.severity] = (overdueBy[r.severity] ?? 0) + r.overdue;
    knownExploitedOpen += r.exploited;
    unassignedOpen += r.unassigned;
  }
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  const aged = await db.query<{ severity: string; age: number; n: number }>(
    `select severity, greatest(current_date - first_seen, 0) as age, count(*)::int as n
     from vulnerabilities where ${OPEN} group by 1, 2`,
  );
  const ageBuckets = AGE_BUCKETS.map((b) => ({ ...b, bySeverity: zero(), total: 0 }));
  for (const r of aged) {
    const bucket = ageBuckets.find((b) => r.age >= b.min && (b.max === null || r.age <= b.max))!;
    bucket.bySeverity[r.severity] = (bucket.bySeverity[r.severity] ?? 0) + r.n;
    bucket.total += r.n;
  }

  const fixed = await db.query<{ severity: string; days: number; n: number }>(
    `select severity, avg(fixed_on - first_seen)::float as days, count(*)::int as n
     from vulnerabilities where deleted_at is null and closed and fixed_on is not null group by 1`,
  );
  const mttr = severities.map((s) => {
    const f = fixed.find((x) => x.severity === s.value);
    return { severity: s.value, days: f ? Math.round(f.days * 10) / 10 : null, fixed: f?.n ?? 0 };
  });
  const fixedThisMonth = (await db.one<{ n: number }>(
    `select count(*)::int as n from vulnerabilities
     where deleted_at is null and closed and fixed_on >= date_trunc('month', current_date)::date`,
  ))!.n;

  const hostRows = await db.query<Row>(
    `select host_key, max(coalesce(nullif(host_name, ''), host_ip)) as host, severity, count(*)::int as n
     from vulnerabilities where ${OPEN} and host_key <> '' group by host_key, severity`,
  );
  const hosts = new Map<string, { host: string; host_key: string; total: number; bySeverity: Record<string, number> }>();
  for (const r of hostRows) {
    const h = hosts.get(r.host_key) ?? { host: r.host, host_key: r.host_key, total: 0, bySeverity: zero() };
    h.bySeverity[r.severity] = (h.bySeverity[r.severity] ?? 0) + r.n;
    h.total += r.n;
    hosts.set(r.host_key, h);
  }
  // Worst first: most critical, then most high and so on, in the order of the severity list.
  const topHosts = [...hosts.values()].sort((a, b) => {
    for (const s of severities) {
      const d = (b.bySeverity[s.value] ?? 0) - (a.bySeverity[s.value] ?? 0);
      if (d) return d;
    }
    return a.host.localeCompare(b.host);
  }).slice(0, 10);

  const overdueByOwner = await db.query<Row>(
    `select v.owner_id, coalesce(u.display_name, 'Unassigned') as owner, count(*)::int as count
     from vulnerabilities v left join users u on u.id = v.owner_id
     where v.deleted_at is null and not v.closed and v.due_on is not null and v.due_on < current_date
     group by 1, 2 order by 3 desc, 2 limit 10`,
  );

  const snaps = await db.query<Row>(
    `select week_start, severity, open_count, overdue_count from vulnerability_snapshots
     where week_start > current_date - ${TREND_WEEKS * 7} order by week_start`,
  );
  const weeks = new Map<string, { week_start: string; bySeverity: Record<string, number>; total: number; overdue: number }>();
  for (const s of snaps) {
    const w = weeks.get(s.week_start) ?? { week_start: s.week_start, bySeverity: zero(), total: 0, overdue: 0 };
    w.bySeverity[s.severity] = s.open_count;
    w.total += s.open_count;
    w.overdue += s.overdue_count;
    weeks.set(s.week_start, w);
  }

  return {
    today: (await db.one<{ d: string }>('select current_date as d'))!.d,
    severities,
    totals: { open: sum(openBy), overdue: sum(overdueBy), knownExploitedOpen, unassignedOpen, fixedThisMonth },
    openBySeverity: severities.map((s) => ({ severity: s.value, count: openBy[s.value] ?? 0 })),
    overdueBySeverity: severities.map((s) => ({ severity: s.value, count: overdueBy[s.value] ?? 0 })),
    ageBuckets,
    mttr,
    topHosts,
    overdueByOwner,
    trend: [...weeks.values()],
  };
}

export function registerSummary(ctx: ModuleContext) {
  ctx.app.get('/api/vulnerabilities/summary', { preHandler: secured(ctx, 'vulnerabilities.view') }, async () => buildSummary(ctx));

  // The trend is real: counts are stored each day (and after every import), never back-filled.
  const timer = setInterval(() => { takeSnapshot(ctx).catch((err) => console.error('[vulnerabilities] snapshot failed:', err)); }, 24 * 3600 * 1000);
  timer.unref();
  ctx.app.addHook('onClose', async () => clearInterval(timer));
}
