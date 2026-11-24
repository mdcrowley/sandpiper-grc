import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Policy translations and the language an acknowledgment was read in (E41-07).
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let author: Client;
let approver: Client;
let reader: Client;
let policyId: string;
let versionId: string;
let personId: string;

const SPANISH = '# Uso aceptable\n\nTexto inventado en español.';
const audit = (action: string) => t.db.query<any>('select * from audit_events where action = $1 and record_id = $2 order by id', [action, policyId]);

async function approveAndPublish(id: string, vid: string) {
  await author.post(`/api/policies/${id}/versions/${vid}/submit`);
  await approver.post(`/api/policies/${id}/versions/${vid}/approve`, {});
  return author.post(`/api/policies/${id}/versions/${vid}/publish`);
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'people,policies';
  t = await testApp();
  author = await t.as('security_lead');
  approver = await t.as('security_lead');
  reader = await t.as('agent');
  const pos = (await t.api.post('/api/positions', { name: 'Invented depot cleaner' })).body.id;
  personId = (await t.api.post('/api/people', { full_name: 'Dana Example', employee_number: 'T1', position_id: pos })).body.id;
  const p = await author.post('/api/policies', {
    title: 'Invented acceptable use', summary: 'How to use equipment.', audience_everyone: true, ack_roster: true, audience_positions: [pos],
  });
  policyId = p.body.id;
  versionId = (await author.post(`/api/policies/${policyId}/versions`, { body: '# Acceptable use\n\nInvented English text.', change_summary: 'First issue' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('translations of a version', () => {
  it('lists the languages a version can be translated into', async () => {
    const res = await reader.get('/api/policies/translation-languages');
    expect(res.body.original.code).toBe('en');
    expect(res.body.languages.map((l: any) => l.code)).toEqual(['es']);
  });

  it('adds a translation to a draft, checking the language and the fields', async () => {
    const url = `/api/policies/${policyId}/versions/${versionId}/translations`;
    expect((await author.put(`${url}/fr`, { title: 'x', body: 'y' })).status).toBe(400);
    expect((await author.put(`${url}/en`, { title: 'x', body: 'y' })).status).toBe(400);
    const empty = await author.put(`${url}/es`, { title: '', body: ' ' });
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.error.fields).sort()).toEqual(['body', 'title']);
    expect((await reader.put(`${url}/es`, { title: 'x', body: 'y' })).status).toBe(403);
    const res = await author.put(`${url}/es`, { title: 'Uso aceptable inventado', summary: 'Cómo usar el equipo.', change_summary: 'Primera edición', body: SPANISH });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ language: 'es', language_name: 'Español', title: 'Uso aceptable inventado' });
    expect(res.body.body_html).toContain('<h1');
    expect((await audit('policy.translation_save')).length).toBe(1);
    // Readers do not see drafts or their translations.
    expect((await reader.get(url)).status).toBe(404);
    expect((await author.get(url)).body.rows.map((r: any) => r.language)).toEqual(['es']);
  });

  it('shows the person the translation they ask for and records the language they read', async () => {
    const pub = await approveAndPublish(policyId, versionId);
    expect(pub.status).toBe(200);
    expect((await reader.get(`/api/policies/${policyId}/versions/${versionId}/translations`)).body.rows).toHaveLength(1);

    const mine = await reader.get('/api/policies/acknowledgments/mine?lang=es');
    const row = mine.body.awaiting.find((a: any) => a.policy_id === policyId);
    expect(row).toMatchObject({ policy_title: 'Uso aceptable inventado', language: 'es' });
    expect((await reader.get('/api/policies/acknowledgments/mine')).body.awaiting.find((a: any) => a.policy_id === policyId).policy_title).toBe('Invented acceptable use');

    const es = await reader.get(`/api/policies/acknowledgments/${row.id}?lang=es`);
    expect(es.body).toMatchObject({ language: 'es', original_language: 'en', translations: ['es'], policy_title: 'Uso aceptable inventado', change_summary: 'Primera edición' });
    expect(es.body.body_html).toContain('español');
    const en = await reader.get(`/api/policies/acknowledgments/${row.id}`);
    expect(en.body).toMatchObject({ language: 'en', policy_title: 'Invented acceptable use' });
    expect(en.body.body_html).toContain('Invented English text');

    const ack = await reader.post(`/api/policies/acknowledgments/${row.id}/acknowledge`, { language: 'es' });
    expect(ack.status).toBe(200);
    expect(ack.body.acknowledged_language).toBe('es');
    const event = (await audit('policy.acknowledge')).at(-1);
    expect(event.summary).toContain('read in Spanish');
    expect(JSON.parse(typeof event.after === 'string' ? event.after : JSON.stringify(event.after)).language).toBe('es');

    const tracking = await author.get(`/api/policies/${policyId}/acknowledgments`);
    expect(tracking.body.rows.find((r: any) => r.user_id === reader.userId).language).toBe('es');
    const csv = await author.get(`/api/policies/${policyId}/acknowledgments?format=csv`);
    expect(csv.text).toContain('Language read');
    expect(csv.text).toContain('Spanish');

    // W23 F5: the acknowledgment records which translated text was read, by its stamp.
    const stamp = (await author.get(`/api/policies/${policyId}/versions/${versionId}/translations`)).body.rows[0].sha256;
    expect(stamp).toMatch(/^[0-9a-f]{64}$/);
    expect(tracking.body.rows.find((r: any) => r.user_id === reader.userId).translation_sha256).toBe(stamp);
    expect(JSON.parse(typeof event.after === 'string' ? event.after : JSON.stringify(event.after)).translation_sha256).toBe(stamp);
    expect(csv.text).toContain('Translation read (SHA-256)');
    expect(csv.text).toContain(stamp);
  });

  it('records the original language when the version has no translation in the language given', async () => {
    const mine = (await author.get('/api/policies/acknowledgments/mine')).body.awaiting.find((a: any) => a.policy_id === policyId);
    await t.db.query('delete from policy_version_translations where version_id = $1', [versionId]);
    const ack = await author.post(`/api/policies/acknowledgments/${mine.id}/acknowledge`, { language: 'es' });
    expect(ack.body.acknowledged_language).toBe('en');
    const tracked = (await author.get(`/api/policies/${policyId}/acknowledgments`)).body.rows.find((r: any) => r.user_id === author.userId);
    expect(tracked).toMatchObject({ language: 'en', translation_sha256: null });
    // Put it back for the kiosk.
    expect((await author.put(`/api/policies/${policyId}/versions/${versionId}/translations/es`, { title: 'Uso aceptable inventado', body: SPANISH })).status).toBe(200);
  });

  it('gives the kiosk the chosen language and records it per document', async () => {
    const pending = await author.get(`/api/policies/kiosk/pending?person_id=${personId}&employee_number=T1&lang=es`);
    expect(pending.status).toBe(200);
    expect(pending.body.items[0]).toMatchObject({ language: 'es', original_language: 'en', policy_title: 'Uso aceptable inventado' });
    expect(pending.body.items[0].body_html).toContain('español');
    const plain = await author.get(`/api/policies/kiosk/pending?person_id=${personId}&employee_number=T1`);
    expect(plain.body.items[0].language).toBe('en');
    const id = pending.body.items[0].id;
    const ack = await author.post('/api/policies/kiosk/acknowledge', { person_id: personId, employee_number: 'T1', ack_ids: [id], languages: { [id]: 'es' } });
    expect(ack.body.acknowledged).toBe(1);
    const tracked = await author.get(`/api/policies/${policyId}/person-acknowledgments`);
    expect(tracked.body.rows.find((r: any) => r.person_id === personId)).toMatchObject({ method: 'kiosk', language: 'es' });
    const stamp = (await author.get(`/api/policies/${policyId}/versions/${versionId}/translations`)).body.rows[0].sha256;
    expect(tracked.body.rows.find((r: any) => r.person_id === personId).translation_sha256).toBe(stamp);
  });

  it('needs approval rights to change or remove the translation of a published version (W23 F5)', async () => {
    const role = (await t.db.one<{ id: string }>(`insert into roles (key, name) values ('w23_pol_editor', 'Policy editor (test)') returning id`))!;
    for (const perm of ['policies.view', 'policies.edit', 'policies.create']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, perm]);
    const editor = await t.as('w23_pol_editor');
    const url = `/api/policies/${policyId}/versions/${versionId}/translations/es`;
    const before = (await author.get(`/api/policies/${policyId}/versions/${versionId}/translations`)).body.rows[0];
    const put = await editor.put(url, { title: 'Cambiado sin aprobación', body: 'Otro texto.' });
    expect(put.status).toBe(403);
    expect(put.body.error.message).toMatch(/approve/);
    expect((await editor.del(url)).status).toBe(403);
    const after = (await author.get(`/api/policies/${policyId}/versions/${versionId}/translations`)).body.rows[0];
    expect(after).toMatchObject({ title: before.title, body: before.body, sha256: before.sha256 });
    // On a draft, policies.edit is still enough.
    const draft = (await author.post(`/api/policies/${policyId}/versions`, { body: 'Invented draft text.' })).body.id;
    expect((await editor.put(`/api/policies/${policyId}/versions/${draft}/translations/es`, { title: 'Borrador', body: 'Texto del borrador.' })).status).toBe(200);
    expect((await editor.del(`/api/policies/${policyId}/versions/${draft}/translations/es`)).status).toBe(200);
    expect((await author.del(`/api/policies/${policyId}/versions/${draft}`)).status).toBe(200);
  });

  it('keeps the replaced text in the audit trail, and freezes the translations of a superseded version', async () => {
    const url = `/api/policies/${policyId}/versions/${versionId}/translations/es`;
    const changed = await author.put(url, { title: 'Uso aceptable inventado', body: `${SPANISH}\n\nCorregido.` });
    expect(changed.status).toBe(200);
    const last = (await audit('policy.translation_save')).at(-1);
    const before = typeof last.before === 'string' ? JSON.parse(last.before) : last.before;
    expect(before.body).toBe(SPANISH);

    const v2 = (await author.post(`/api/policies/${policyId}/versions`, { body: 'Invented second text.' })).body.id;
    expect((await author.put(`/api/policies/${policyId}/versions/${v2}/translations/es`, { title: 'Segunda', body: 'Segundo texto.' })).status).toBe(200);
    // A discarded draft takes its translations with it.
    expect((await author.del(`/api/policies/${policyId}/versions/${v2}`)).status).toBe(200);
    expect((await t.db.query('select 1 from policy_version_translations where version_id = $1', [v2])).length).toBe(0);

    const v3 = (await author.post(`/api/policies/${policyId}/versions`, { body: 'Invented third text.' })).body.id;
    await approveAndPublish(policyId, v3);
    expect((await author.put(url, { title: 'x', body: 'y' })).status).toBe(409);
    expect((await author.del(url)).status).toBe(409);
    expect((await author.del(`/api/policies/${policyId}/versions/${v3}/translations/es`)).status).toBe(404);
  });
});
