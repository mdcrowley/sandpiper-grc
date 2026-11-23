import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import {
  MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, type MobilePackage, type PackageCondition, type PackageCount, type PackageInspection, type SyncAnswer,
} from '../../../../shared/mobile-api.ts';

// Field work offline (wave 15, E38-11 and E38-12): inspections completed on the phone, condition
// assessments and inventory count finds, sent through the outbox. Each goes through the web's own
// routes as the person, so the rules are the web runner's; the same batch twice does nothing twice;
// a canceled inspection or a removed permission is refused (Needs attention); finds from two phones merge.

let t: Awaited<ReturnType<typeof testApp>>;
type Api = typeof t.api;
const today = dayInZone();

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function signIn(api: Api = t.api): Promise<string> {
  const { verifier, challenge } = pkce();
  const installation = randomUUID();
  const params = {
    response_type: 'code', client_id: MOBILE_CLIENT_ID, redirect_uri: MOBILE_REDIRECT_URI, scope: 'mobile', state: 'st-1',
    code_challenge: challenge, code_challenge_method: 'S256', installation_id: installation, device_name: 'Field phone 3',
    device_platform: 'android', app_version: '0.1.0',
  };
  const decision = await api.post('/api/mobile/oauth/decision', { ...params, approve: true });
  expect(decision.status, JSON.stringify(decision.body)).toBe(200);
  const code = new URL(decision.body.redirect).searchParams.get('code')!;
  const res = await t.app.inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: MOBILE_REDIRECT_URI, client_id: MOBILE_CLIENT_ID, installation_id: installation }).toString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().access_token;
}

const bearer = async (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await t.app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, ...(payload !== undefined ? { payload: payload as any } : {}) });
  let body: any = null;
  try { body = res.json(); } catch { /* empty */ }
  return { status: res.statusCode, body };
};
const sync = (token: string, items: unknown[]) => bearer(token, 'POST', '/api/mobile/sync', { items });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(300)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), randomBytes(400), Buffer.from([0xff, 0xd9])]);
/** A photo item of the outbox, attached to a record. */
const photo = (token: string, clientId: string, recordType: string, recordId: string, name: string, bytes = JPEG) =>
  bearer(token, 'PUT', `/api/mobile/sync/attachment?${new URLSearchParams({ clientId, record_type: recordType, record_id: recordId, name })}`, bytes,
    { 'content-type': 'application/octet-stream', 'idempotency-key': clientId });

let lead: Awaited<ReturnType<typeof t.as>>;
let leadToken: string;

/** A template with items, and an inspection of it assigned to `inspectorId`. */
async function makeInspection(inspectorId: string, items: { prompt: string; critical?: boolean; photo_required?: boolean }[]) {
  const tpl = await lead.post('/api/checklist-templates', { name: `Invented check ${randomUUID().slice(0, 6)}`, kind: 'inspection', target_type: 'site' });
  expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
  const put = await lead.put(`/api/checklist-templates/${tpl.body.id}/items`, { items });
  expect(put.status).toBe(200);
  const ins = await lead.post('/api/inspections', { template_id: tpl.body.id, target_type: 'none', inspector_id: inspectorId, due_on: today });
  expect(ins.status, JSON.stringify(ins.body)).toBe(201);
  return { id: ins.body.id as string, ref: ins.body.ref as string, items: put.body.items as { id: string; prompt: string }[] };
}

beforeAll(async () => {
  t = await testApp();
  const on = await t.api.patch('/api/admin/features', { features: { mobile: true } });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  lead = await t.as('audit_lead');
  leadToken = await signIn(lead);
});
afterAll(async () => { await t.close(); });

describe('inspections offline', () => {
  it('completes an inspection from the phone: photos first, then answers, completion and signature, once', async () => {
    const ins = await makeInspection(lead.userId, [
      { prompt: 'Invented exits clear', critical: true }, { prompt: 'Invented extinguisher tagged', photo_required: true }, { prompt: 'Invented lights working' },
    ]);
    const [exits, ext, lights] = ins.items;
    // The outbox: two photos and the signature (attachment items), then the completion.
    const p1 = randomUUID();
    const sig = randomUUID();
    expect((await photo(leadToken, p1, 'inspection', ins.id, 'photo-1.jpg')).body.status).toBe('done');
    expect((await photo(leadToken, sig, 'inspection', ins.id, 'signature.png', PNG)).body.status).toBe('done');
    const complete = {
      clientId: randomUUID(), kind: 'inspection.complete',
      payload: {
        inspectionId: ins.id, raiseFindings: true, notes: 'Invented: done on the night shift.',
        answers: [
          { itemId: exits.id, answer: 'yes' }, { itemId: ext.id, answer: 'yes', photos: [p1] }, { itemId: lights.id, answer: 'no', note: 'Invented: two lamps out at the stairs.' },
        ],
        signature: { name: 'Test inspector', photo: sig },
      },
    };
    const first = await sync(leadToken, [complete]);
    expect(first.body.items[0], JSON.stringify(first.body)).toMatchObject({
      status: 'done', result: { recordType: 'inspection', id: ins.id, outcome: 'pass_with_findings', scorePct: 66.7 },
    });
    expect(first.body.items[0].result.findings).toHaveLength(1);
    expect(first.body.items[0].result.message).toMatch(/Pass with findings \(66\.7%\); 1 finding raised/);
    // The answer was lost: sent again, nothing is done twice.
    const again = await sync(leadToken, [complete]);
    expect(again.body.items[0]).toMatchObject({ status: 'done', replayed: true });
    expect(await t.db.query(`select id from audit_findings where source_id = $1 and deleted_at is null`, [ins.id])).toHaveLength(1);
    expect(await t.db.query(`select id from audit_events where action = 'inspection.complete' and record_id = $1`, [ins.id])).toHaveLength(1);
    // On the web: complete, signed, with the photo on the item and the note as the finding's condition.
    const web = await lead.get(`/api/inspections/${ins.id}`);
    expect(web.body).toMatchObject({ status: 'complete', result: 'pass_with_findings', signed_by_name: 'Test inspector', notes: 'Invented: done on the night shift.' });
    const answers = (await lead.get(`/api/inspections/${ins.id}/responses`)).body.responses;
    expect(answers[ext.id].attachment_ids).toHaveLength(1);
    const finding = await t.db.one<any>(`select condition, rating from audit_findings where source_id = $1`, [ins.id]);
    expect(finding).toEqual({ condition: 'Invented: two lamps out at the stairs.', rating: 'minor_nonconformity' });
    const ev = await t.db.one<any>(`select after from audit_events where action = 'inspection.complete' and record_id = $1`, [ins.id]);
    expect(ev.after.signature_attachment_id).toBe((await t.db.one<any>(`select id from attachments where record_id = $1 and file_name = 'signature.png'`, [ins.id])).id);
  });

  it('applies the web runner\'s rules: the same answers give the same result, score and refusals', async () => {
    const items = [{ prompt: 'Invented ramp clear', critical: true }, { prompt: 'Invented rail fixed' }, { prompt: 'Invented sign lit', photo_required: true }];
    const viaWeb = await makeInspection(lead.userId, items);
    const viaApp = await makeInspection(lead.userId, items);
    const given = (ids: string[]) => [{ item_id: ids[0], answer: 'no' }, { item_id: ids[1], answer: 'yes' }, { item_id: ids[2], answer: 'na' }];
    await lead.put(`/api/inspections/${viaWeb.id}/responses`, { responses: given(viaWeb.items.map((i) => i.id)) });
    const web = await lead.post(`/api/inspections/${viaWeb.id}/complete`, {});
    const app = await sync(leadToken, [{
      clientId: randomUUID(), kind: 'inspection.complete',
      payload: { inspectionId: viaApp.id, answers: given(viaApp.items.map((i) => i.id)).map((a) => ({ itemId: a.item_id, answer: a.answer })) },
    }]);
    expect(app.body.items[0].status).toBe('done');
    expect(app.body.items[0].result.outcome).toBe(web.body.inspection.result);
    expect(app.body.items[0].result.scorePct).toBe(Number(web.body.inspection.score_pct));
    expect(app.body.items[0].result.findings.length).toBe(web.body.findings.length);

    // An item that needs a photo answered "met" without one: refused with the web's reason, and kept.
    const noPhoto = await makeInspection(lead.userId, items);
    const refused = await sync(leadToken, [{
      clientId: randomUUID(), kind: 'inspection.complete',
      payload: { inspectionId: noPhoto.id, answers: noPhoto.items.map((i) => ({ itemId: i.id, answer: 'yes' })) },
    }]);
    expect(refused.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'photo_required' } });
    // A photo that never arrived is named as such.
    const lost = await sync(leadToken, [{
      clientId: randomUUID(), kind: 'inspection.complete',
      payload: { inspectionId: noPhoto.id, answers: [{ itemId: noPhoto.items[2].id, answer: 'yes', photos: [randomUUID()] }] },
    }]);
    expect(lost.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'photo_missing' } });
  });

  it('saves answers without completing, and refuses a canceled inspection and a removed permission', async () => {
    const ins = await makeInspection(lead.userId, [{ prompt: 'Invented door shut' }, { prompt: 'Invented alarm armed' }]);
    const saved = await sync(leadToken, [{ clientId: randomUUID(), kind: 'inspection.answers', payload: { inspectionId: ins.id, answers: [{ itemId: ins.items[0].id, answer: 'yes', note: 'Invented note' }] } }]);
    expect(saved.body.items[0]).toMatchObject({ status: 'done', result: { message: '1 answer saved.' } });
    expect((await lead.get(`/api/inspections/${ins.id}`)).body.status).toBe('in_progress');

    // Canceled on the web while the phone was offline.
    expect((await lead.patch(`/api/inspections/${ins.id}`, { status: 'canceled' })).status).toBe(200);
    const canceled = await sync(leadToken, [{ clientId: randomUUID(), kind: 'inspection.complete', payload: { inspectionId: ins.id, answers: ins.items.map((i) => ({ itemId: i.id, answer: 'yes' })) } }]);
    expect(canceled.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'inspection_canceled' } });
    expect(canceled.body.items[0].error.message).toMatch(/canceled/);

    // The inspector loses the audits permission.
    const other = await makeInspection(lead.userId, [{ prompt: 'Invented fence intact' }]);
    const inspector = await t.as('audit_lead');
    const token = await signIn(inspector);
    await lead.patch(`/api/inspections/${other.id}`, { inspector_id: inspector.userId });
    await t.db.query('delete from user_roles where user_id = $1', [inspector.userId]);
    await t.db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'project_manager'`, [inspector.userId]);
    const gone = await sync(token, [{ clientId: randomUUID(), kind: 'inspection.complete', payload: { inspectionId: other.id, answers: [{ itemId: other.items[0].id, answer: 'yes' }] } }]);
    expect(gone.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'forbidden' } });
    expect((await lead.get(`/api/inspections/${other.id}`)).body.status).toBe('scheduled');
  });

  it('puts my inspections in the package with their checklists and the answers given so far', async () => {
    const ins = await makeInspection(lead.userId, [{ prompt: 'Invented bay swept', photo_required: true }, { prompt: 'Invented bins emptied' }]);
    await lead.put(`/api/inspections/${ins.id}/responses`, { item_id: ins.items[1].id, answer: 'na', note: 'Invented: no bins here.' });
    const p = (await bearer(leadToken, 'GET', '/api/mobile/package')).body as MobilePackage;
    const mine = (p.parts.inspections as PackageInspection[]).find((i) => i.id === ins.id)!;
    expect(mine.checklist).toMatchObject({ canAnswer: true, template: { name: expect.stringMatching(/^Invented check/) } });
    expect(mine.checklist!.items.map((i) => [i.prompt, i.photo_required])).toEqual([['Invented bay swept', true], ['Invented bins emptied', false]]);
    expect(mine.checklist!.responses[ins.items[1].id]).toEqual({ answer: 'na', note: 'Invented: no bins here.', photos: 0 });
    // A canceled one is not in the package.
    await lead.patch(`/api/inspections/${ins.id}`, { status: 'canceled' });
    const later = (await bearer(leadToken, 'GET', '/api/mobile/package')).body as MobilePackage;
    expect((later.parts.inspections as PackageInspection[]).some((i) => i.id === ins.id)).toBe(false);
  });
});

describe('condition assessments offline', () => {
  it('records an assessment dated when it was made, once, with its photo', async () => {
    const manager = await t.as('asset_manager');
    const token = await signIn(manager);
    const asset = await manager.post('/api/assets', { name: 'Invented lift 2' });
    expect(asset.status, JSON.stringify(asset.body)).toBe(201);
    const p = (await bearer(token, 'GET', '/api/mobile/package')).body as MobilePackage;
    expect(p.lookups.condition_rating?.length).toBeGreaterThan(0);
    expect(p.parts.condition as PackageCondition).toMatchObject({ due: expect.any(Array) });
    const rating = p.lookups.condition_rating[0].value;
    const yesterday = dayInZone(-1);
    const item = { clientId: randomUUID(), kind: 'condition.assess', payload: { targetType: 'asset', targetId: asset.body.id, assessedOn: yesterday, rating, notes: 'Invented: worn steps.' } };
    const first = await sync(token, [item]);
    expect(first.body.items[0], JSON.stringify(first.body)).toMatchObject({ status: 'done', result: { recordType: 'condition_assessment', ref: expect.stringMatching(/^CND-/) } });
    expect((await sync(token, [item])).body.items[0]).toMatchObject({ status: 'done', replayed: true });
    const rows = await t.db.query<any>(`select assessed_on::text as d, rating from condition_assessments where target_id = $1 and deleted_at is null`, [asset.body.id]);
    expect(rows).toEqual([{ d: yesterday, rating }]);
    const pic = await bearer(token, 'PUT', `/api/mobile/sync/attachment?${new URLSearchParams({ clientId: randomUUID(), parent: item.clientId, name: 'photo-1.jpg' })}`, JPEG,
      { 'content-type': 'application/octet-stream' });
    expect(pic.body).toMatchObject({ status: 'done', result: { recordType: 'condition_assessment', id: first.body.items[0].result.id } });
    // Something wrong is refused with the route's reason.
    const future = await sync(token, [{ clientId: randomUUID(), kind: 'condition.assess', payload: { ...item.payload, assessedOn: dayInZone(3) } }]);
    expect(future.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'validation' } });
  });
});

describe('inventory counts offline', () => {
  it('merges finds from two phones, answers a repeat from memory, and refuses once the count is over', async () => {
    const manager = await t.as('asset_manager');
    const helper = await t.as('asset_manager');
    const [phoneA, phoneB] = [await signIn(manager), await signIn(helper)];
    const site = await manager.post('/api/sites', { name: 'Invented depot 21' });
    const elsewhere = await manager.post('/api/sites', { name: 'Invented depot 22' });
    const assets = [];
    for (const n of [1, 2, 3]) assets.push((await manager.post('/api/assets', { name: `Invented charger ${n}`, site_id: site.body.id })).body);
    const stray = (await manager.post('/api/assets', { name: 'Invented charger 9', site_id: elsewhere.body.id })).body;
    expect(assets.every((a) => a.tag) && stray.tag).toBeTruthy();
    const count = await manager.post('/api/inventory-counts/start', { site_id: site.body.id, record_types: ['asset'] });
    expect(count.status, JSON.stringify(count.body)).toBe(201);

    // Both phones downloaded the count with what it expects, and the tag values to recognize offline.
    const pkg = (await bearer(phoneB, 'GET', '/api/mobile/package')).body as MobilePackage;
    const offline = (pkg.parts.counts as PackageCount[]).find((c) => c.id === count.body.id)!;
    expect(offline.items.filter((i) => i.expected).map((i) => i.tagValue).sort()).toEqual(assets.map((a) => a.tag).sort());
    expect(pkg.tags?.values.map((v) => v.value)).toEqual(expect.arrayContaining(assets.map((a) => a.tag)));

    const found = (value: string) => ({ clientId: randomUUID(), kind: 'count.found', payload: { countId: count.body.id, value, source: 'code' } });
    const a = [found(assets[0].tag), found(assets[1].tag)];
    const b = [found(assets[1].tag), found(assets[2].tag), found(stray.tag), found('INVENTED-NOTHING-1')];
    const fromA = await sync(phoneA, a);
    const fromB = await sync(phoneB, b);
    expect(fromA.body.items.map((x: SyncAnswer) => x.result?.outcome)).toEqual(['found', 'found']);
    expect(fromB.body.items.map((x: SyncAnswer) => x.result?.outcome)).toEqual(['already_found', 'found', 'unexpected', 'not_found']);
    // Phone A sends its batch again (its answer was lost): nothing changes.
    expect((await sync(phoneA, a)).body.items.map((x: SyncAnswer) => x.replayed)).toEqual([true, true]);
    const totals = (await manager.get(`/api/inventory-counts/${count.body.id}/items`)).body.totals;
    expect(totals).toMatchObject({ expected: 3, found: 3, unexpected: 1, pending: 0 });
    expect(await t.db.query(`select id from audit_events where action = 'inventory_count.found' and record_id = $1`, [count.body.id])).toHaveLength(4);

    // Finished on the web: a late find waits in Needs attention with the reason.
    expect((await manager.post(`/api/inventory-counts/${count.body.id}/finish`, {})).status).toBe(200);
    const late = await sync(phoneB, [found(assets[0].tag)]);
    expect(late.body.items[0]).toMatchObject({ status: 'rejected', error: { code: 'not_open' } });
  });
});
