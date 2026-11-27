// E18-77: an incident's notification questions are recorded as answered, so "no clock" is not read as
// "no notification required" while nobody has answered them. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('notification questions answered', () => {
  it('records the answers from the declare flow or the Affected tab, and the clocks say so', async () => {
    const quick = (await t.api.post('/api/security-incidents', { title: 'Invented quick record', severity: 'high' })).body;
    expect(quick.answers_confirmed_at).toBeNull();
    const clocks = (await t.api.get(`/api/security-incidents/${quick.id}/clocks`)).body;
    expect(clocks.answers_confirmed).toBe(false);
    expect(typeof clocks.rules_active).toBe('number');
    // Answering one question on the Affected tab records it; an edit of other fields does not.
    expect((await t.api.patch(`/api/security-incidents/${quick.id}`, { summary: 'Invented summary' })).body.answers_confirmed_at).toBeNull();
    const answered = (await t.api.patch(`/api/security-incidents/${quick.id}`, { personal_info_involved: false })).body;
    expect(answered.answers_confirmed_at).not.toBeNull();
    expect((await t.api.get(`/api/security-incidents/${quick.id}/clocks`)).body.answers_confirmed).toBe(true);
    // Confirming the answers as they stand (the button sends the kinds of data unchanged) counts too.
    const other = (await t.api.post('/api/security-incidents', { title: 'Invented second record' })).body;
    expect((await t.api.patch(`/api/security-incidents/${other.id}`, { data_kinds: [] })).body.answers_confirmed_at).not.toBeNull();
    // The declare flow sends every answer.
    const declared = (await t.api.post('/api/security-incidents', { title: 'Invented declared', is_cyber_incident: true, personal_info_involved: false })).body;
    expect(declared.answers_confirmed_at).not.toBeNull();
    // Nobody sets it by hand.
    const forced = (await t.api.post('/api/security-incidents', { title: 'Invented forced', answers_confirmed_at: '2020-01-01T00:00:00Z' })).body;
    expect(forced.answers_confirmed_at).toBeNull();
  });
});
