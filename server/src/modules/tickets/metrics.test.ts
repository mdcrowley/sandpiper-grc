import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { clock } from './clock.ts';

// A small fixed, invented data set. "Now" is Wednesday 18 November 2026, 12:00 local (17:00Z).
let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  t = await testApp();
  clock.set('2026-11-18T17:00:00Z');
  const make = (data: Record<string, unknown>) => t.ctx.resources.create('ticket', { requester_name: 'Sam Example', ...data });
  // A: quick, inside every target, closed with a good score.
  await make({
    title: 'A', impact: 'individual', urgency: 'high', category: 'hardware', requester_department: 'Finance', status: 'closed',
    resolution_code: 'fixed', opened_at: '2026-11-16T14:00:00Z', first_responded_at: '2026-11-16T14:30:00Z',
    resolved_at: '2026-11-16T16:00:00Z', satisfaction_score: 4,
  });
  // B: P2, late response (due 16:00Z) and late resolution (due 17 Nov 15:00Z); the vendor answered in 2 hours.
  await make({
    title: 'B', impact: 'department', urgency: 'high', category: 'network', requester_department: 'Operations', status: 'resolved',
    resolution_code: 'vendor_fix', opened_at: '2026-11-16T15:00:00Z', first_responded_at: '2026-11-16T17:00:00Z',
    resolved_at: '2026-11-17T20:00:00Z', satisfaction_score: 2, with_vendor: true,
    vendor_raised_at: '2026-11-16T16:00:00Z', vendor_responded_at: '2026-11-16T18:00:00Z',
  });
  // C: P4, still new; its response target (one business day) passed at 14:00Z today.
  await make({ title: 'C', impact: 'individual', urgency: 'medium', category: 'hardware', requester_department: 'Finance', opened_at: '2026-11-17T14:00:00Z' });
  // D: opened two hours ago, waiting on a vendor.
  await make({
    title: 'D', impact: 'individual', urgency: 'medium', category: 'software', requester_department: 'Operations',
    status: 'waiting_vendor', with_vendor: true, opened_at: '2026-11-18T15:00:00Z',
  });
  // E: outside the reporting range.
  await make({
    title: 'E', impact: 'individual', urgency: 'low', category: 'other', requester_department: 'Human Resources', status: 'closed',
    opened_at: '2026-10-01T14:00:00Z', first_responded_at: '2026-10-01T14:10:00Z', resolved_at: '2026-10-01T15:00:00Z',
  });
});
afterAll(async () => { clock.set(null); await t.close(); });

describe('service desk metrics', () => {
  it('are correct for a date range', async () => {
    const res = await t.api.get('/api/tickets/metrics?from=2026-11-16&to=2026-11-18');
    expect(res.status).toBe(200);
    const m = res.body;
    expect(m).toMatchObject({ total: 4, open: 2, resolved: 2 });
    expect(m.volume_by_day).toEqual([
      { day: '2026-11-16', opened: 2, resolved: 1 },
      { day: '2026-11-17', opened: 1, resolved: 1 },
      { day: '2026-11-18', opened: 1, resolved: 0 },
    ]);
    expect(m.by_category.map((g: any) => [g.value, g.label, g.count])).toEqual([
      ['hardware', 'Hardware', 2], ['network', 'Network and connectivity', 1], ['software', 'Software', 1],
    ]);
    expect(m.by_department.map((g: any) => [g.value, g.count, g.breached])).toEqual([['Finance', 2, 1], ['Operations', 2, 1]]);
    expect(m.by_priority.map((g: any) => [g.value, g.count]).sort()).toEqual([['p2', 1], ['p3', 1], ['p4', 2]]);
    // First response: A 30 min, B 120 min, D 0 min. Resolution: A 120 min, B 1740 min.
    expect(m.first_response).toEqual({ average_minutes: 50, count: 3 });
    expect(m.resolution).toEqual({ average_minutes: 930, count: 2 });
    expect(m.sla.response).toEqual({ measured: 4, breached: 2, compliance_pct: 50 });
    expect(m.sla.resolve).toEqual({ measured: 2, breached: 1, compliance_pct: 50 });
    expect(m.sla.breaches).toBe(2);
    expect(m.sla.compliance_pct).toBe(50);
    expect(m.satisfaction).toEqual({ average: 3, count: 2 });
    expect(m.vendor).toEqual({ held: 1, tickets: 2, average_response_minutes: 120, responses: 1 });
    // Backlog as it stands now: D is 2 hours old, C is 27 hours old.
    expect(m.backlog.total).toBe(2);
    expect(m.backlog.buckets.map((b: any) => b.count)).toEqual([1, 1, 0, 0, 0]);
  });

  it('cover everything when no range is given, and reject a bad date', async () => {
    const all = (await t.api.get('/api/tickets/metrics')).body;
    expect(all.total).toBe(5);
    expect(all.resolved).toBe(3);
    expect(all.by_department.map((g: any) => g.value)).toContain('Human Resources');
    expect((await t.api.get('/api/tickets/metrics?from=2026-11-18')).body.total).toBe(1);
    expect((await t.api.get('/api/tickets/metrics?from=yesterday')).status).toBe(400);
  });

  it('give drill-down bounds that match the ticket list', async () => {
    const m = (await t.api.get('/api/tickets/metrics')).body;
    for (const b of m.backlog.buckets) {
      const qs = ['f.resolved_at.null=true', `f.opened_at.lte=${encodeURIComponent(b.opened_before)}`];
      if (b.opened_after) qs.push(`f.opened_at.gt=${encodeURIComponent(b.opened_after)}`);
      expect((await t.api.get(`/api/tickets?${qs.join('&')}`)).body.total).toBe(b.count);
    }
    expect((await t.api.get('/api/tickets?f.category=hardware&f.opened_at.gte=2026-11-16')).body.total).toBe(2);
    // E18-16: the "missed target" tile counts either target; the list it opens filters on the same thing.
    const ranged = (await t.api.get('/api/tickets/metrics?from=2026-11-16&to=2026-11-18')).body;
    const list = (await t.api.get('/api/tickets?f.target_missed=true&f.opened_at.gte=2026-11-16&f.opened_at.lte=2026-11-18T23:59:59.999')).body;
    expect(list.total).toBe(ranged.sla.breaches);
    expect(list.rows.map((r: any) => r.title).sort()).toEqual(['B', 'C']);
    expect((await t.api.get('/api/tickets?f.resolve_breached=true')).body.total).toBeLessThan(m.sla.breaches);
  });
});
