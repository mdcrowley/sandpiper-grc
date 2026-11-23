import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS } from '../../core/features.ts';
import { testApp } from '../../test/helpers.ts';
import { LIST_LABELS, LIST_SETTINGS } from '../../../../web/src/modules/admin/listLabels.ts';

// Administration > Lists names every list the application ships (wave 15): never its raw key
// ("Kb category", "Ot security level"), and lets an administrator edit the per-value settings a list
// declares (a certification type's validity, a business impact analysis question's kind).
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  // Every area on, so no list is hidden from the check.
  const on = Object.fromEntries(AREAS.map((a) => [a.key, true]));
  expect((await t.api.patch('/api/admin/features', { features: on })).status).toBe(200);
}, 60_000);
afterAll(async () => { await t?.close(); });

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

describe('Administration > Lists', () => {
  it('has a proper name for every list the application ships', async () => {
    const lists = ((await t.api.get('/api/lookups')).body as { list_key: string }[]).map((l) => l.list_key);
    expect(lists.length).toBeGreaterThan(150);
    const missing = lists.filter((k) => !LIST_LABELS[k]);
    expect(missing, 'lists with no name in web/src/modules/admin/listLabels.ts').toEqual([]);
    // A name is words, not the key: no underscores, and no bare abbreviation of a key such as "Kb" or "Ot".
    for (const [key, label] of Object.entries(LIST_LABELS)) {
      expect(label, key).not.toMatch(/_/);
      expect(label, key).toMatch(/^[A-Z]/);
      expect(label, key).not.toMatch(/\b(Kb|Kri|Ot|Bia|Cap|Mfa|Rag)\b/);
      if (/^(kb|kri|ot|bia|cap|mfa|rag)_/.test(key)) expect(label, key).not.toBe(humanize(key));
    }
  });

  it('declares settings only for lists that exist, and the declared kinds are the ones the pages read', async () => {
    const lists = new Set(((await t.api.get('/api/lookups')).body as { list_key: string }[]).map((l) => l.list_key));
    for (const key of Object.keys(LIST_SETTINGS)) expect(lists.has(key), key).toBe(true);
    // Every shipped business impact analysis question has a kind the dialog offers.
    const kinds = new Set(LIST_SETTINGS.bia_question[0].options!.map((o) => o.value));
    for (const q of (await t.api.get('/api/lookups/bia_question')).body) expect(kinds.has(q.meta.kind), q.value).toBe(true);
  });

  it('keeps a value\'s settings when they are edited, and a certification takes its new validity', async () => {
    const types = (await t.api.get('/api/lookups/certification_type')).body as { id: string; value: string; meta: Record<string, unknown> }[];
    const firstAid = types.find((v) => v.value === 'first_aid')!;
    const saved = await t.api.patch(`/api/lookups/${firstAid.id}`, { meta: { ...firstAid.meta, validity_months: 18 } });
    expect(saved.status).toBe(200);
    expect(saved.body.meta).toMatchObject({ validity_months: 18 });
    const person = (await t.api.post('/api/people', { full_name: 'Rowan Example', employee_number: 'L1' })).body.id;
    const cert = await t.api.post('/api/certifications', { person_id: person, certification_type: 'first_aid', issued_on: '2026-01-15' });
    expect(cert.status).toBe(201);
    expect(String(cert.body.expires_on).slice(0, 10)).toBe('2027-07-15');

    // A new business impact analysis question answered as a number.
    const q = await t.api.post('/api/lookups', { list_key: 'bia_question', value: 'staff_needed', label: 'How many staff keep the workaround going?', sort: 90, meta: { kind: 'number' } });
    expect(q.status).toBe(201);
    expect((await t.api.get('/api/lookups/bia_question')).body.find((v: any) => v.value === 'staff_needed').meta).toEqual({ kind: 'number' });
  });
});
