import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { workpaperRefs } from './time.ts';

// E45-63: workpaper reference numbers (A.1, A.2, B.1 by section) and an audit's time budget with the
// hours worked against it, by person and by step; in data load mode the person named and past days.
// Invented audits and people only.

let t: Awaited<ReturnType<typeof testApp>>;
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

beforeAll(async () => {
  t = await testApp();
  await t.db.query(`insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled')`);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('workpaper reference numbers', () => {
  it('number steps by section, or one by one without sections', () => {
    const refs = workpaperRefs([
      { id: 'a', section: 'Planning' }, { id: 'b', section: 'Planning' }, { id: 'c', section: 'Fieldwork' }, { id: 'd', section: 'Planning' },
    ]);
    expect([...refs.values()]).toEqual(['A.1', 'A.2', 'B.1', 'A.3']);
    expect([...workpaperRefs([{ id: 'x', section: null }, { id: 'y', section: '' }]).values()]).toEqual(['1', '2']);
  });

  it('are given on the audit\'s checklist with the audit\'s reference', async () => {
    const tpl = (await t.api.post('/api/checklist-templates', { name: 'Invented audit program', kind: 'audit' })).body;
    await t.api.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: 'Read the policy', section: 'Planning' }, { prompt: 'Sample ten records', section: 'Fieldwork' }] });
    const audit = (await t.api.post('/api/audits', { title: 'Invented fuel audit', audit_type: 'internal_audit', template_id: tpl.id })).body;
    const view = (await t.api.get(`/api/audits/${audit.id}/checklist`)).body;
    expect(view.items.map((i: Row) => [i.wp_ref, i.wp_ref_full])).toEqual([['A.1', `${audit.ref}/A.1`], ['B.1', `${audit.ref}/B.1`]]);
  });
});

describe('time budget', () => {
  it('records hours against the budget, by person and step, and refuses bad entries', async () => {
    const tpl = (await t.api.post('/api/checklist-templates', { name: 'Invented time program', kind: 'audit' })).body;
    const items = (await t.api.put(`/api/checklist-templates/${tpl.id}/items`, { items: [{ prompt: 'Walk the yard' }] })).body.items;
    const audit = (await t.api.post('/api/audits', { title: 'Invented yard audit', audit_type: 'internal_audit', template_id: tpl.id, budget_hours: 10 })).body;
    expect(audit.budget_hours).toBe(10);
    const one = await t.api.post(`/api/audits/${audit.id}/time`, { hours: 6, item_id: items[0].id, activity: 'Fieldwork' });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body).toMatchObject({ budget_hours: 10, worked_hours: 6, remaining_hours: 4, used_pct: 60, over_budget: false });
    expect((await t.api.post(`/api/audits/${audit.id}/time`, { hours: 0.3 })).status).toBe(400);
    expect((await t.api.post(`/api/audits/${audit.id}/time`, { hours: 2, worked_on: '2999-01-01' })).status).toBe(400);
    expect((await t.api.post(`/api/audits/${audit.id}/time`, { hours: 2, item_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const two = (await t.api.post(`/api/audits/${audit.id}/time`, { hours: 5.5, worked_on: dayInZone(-1) })).body;
    expect(two).toMatchObject({ worked_hours: 11.5, remaining_hours: -1.5, over_budget: true });
    expect(two.by_step).toEqual([{ item_id: items[0].id, hours: 6 }]);
    const viewer = await t.as('auditor');
    expect((await viewer.get(`/api/audits/${audit.id}/time`)).status).toBe(200);
    expect((await viewer.post(`/api/audits/${audit.id}/time`, { hours: 1 })).status).toBe(403);
    const removed = await t.api.del(`/api/audits/${audit.id}/time/${two.entries.find((e: Row) => e.hours === 5.5).id}`);
    expect(removed.body.worked_hours).toBe(6);

    // In data load mode: the person named, on a past day.
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const loaded = await t.api.post(`/api/audits/${audit.id}/time`, { hours: 3, worked_on: '2022-05-04', on_behalf_of: 'rclerk' });
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(201);
    expect(loaded.body.by_person.map((p: Row) => p.name)).toContain('Robin Clerk');
    await t.api.post('/api/admin/data-load', { on: false });
  });
});
