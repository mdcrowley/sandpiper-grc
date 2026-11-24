import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { itemOpen } from './certification.ts';

// E41-08: safety and security certification of capital projects. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const ok = (res: { status: number; body: any }, status = 200) => {
  if (res.status !== status) throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
};
const project = async (name = 'Invented light-rail extension') => ok(await t.api.post('/api/projects', { name }), 201);
const item = async (projectId: string, data: Record<string, unknown> = {}) =>
  ok(await t.api.post('/api/certifiable-items', { project_id: projectId, name: 'Platform screen doors', ...data }), 201);
const requirement = async (itemId: string, data: Record<string, unknown> = {}) =>
  ok(await t.api.post('/api/certification-requirements', { item_id: itemId, title: 'Doors stay closed with no train at the platform', ...data }), 201);
const verify = (id: string, data: Record<string, unknown> = {}) =>
  t.api.patch(`/api/certification-requirements/${id}`, { status: 'verified', verification_method: 'test', evidence_ref: 'Test report TR-17', ...data });
const certification = async (projectId: string) => ok(await t.api.get(`/api/projects/${projectId}/certification`));
const issue = (projectId: string, data: Record<string, unknown> = {}) =>
  t.api.post(`/api/projects/${projectId}/certificates`, { scope: 'Revenue service of the extension', ...data });

describe('certifiable items and requirements', () => {
  it('an item is open until it has requirements and every one is verified or not applicable', async () => {
    expect(itemOpen(0, 0)).toBe(true);
    expect(itemOpen(2, 1)).toBe(true);
    expect(itemOpen(2, 0)).toBe(false);
    const p = await project();
    const i = await item(p.id);
    expect(i.ref).toMatch(/^CI-\d{5}$/);
    expect(i.status).toBe('open');
    const r1 = await requirement(i.id);
    expect(r1.ref).toMatch(/^CR-\d{5}$/);
    expect(r1.project_id).toBe(p.id);
    const r2 = await requirement(i.id, { title: 'Emergency release works from the platform side' });
    let row = ok(await t.api.get(`/api/certifiable-items/${i.id}`));
    expect([row.status, row.requirements_total, row.requirements_open]).toEqual(['open', 2, 2]);
    ok(await verify(r1.id));
    ok(await t.api.patch(`/api/certification-requirements/${r2.id}`, { status: 'not_applicable', verification_notes: 'Release is on the train side only in this design.' }));
    row = ok(await t.api.get(`/api/certifiable-items/${i.id}`));
    expect([row.status, row.requirements_total, row.requirements_open]).toEqual(['verified', 2, 0]);
    // Deleting a requirement can leave the item open again.
    ok(await t.api.del(`/api/certification-requirements/${r1.id}`));
    ok(await t.api.del(`/api/certification-requirements/${r2.id}`));
    expect(ok(await t.api.get(`/api/certifiable-items/${i.id}`)).status).toBe('open');
  });

  it('verifying needs a method and evidence, and records who and when; reopening clears it', async () => {
    const p = await project();
    const r = await requirement((await item(p.id)).id);
    const bare = await t.api.patch(`/api/certification-requirements/${r.id}`, { status: 'verified' });
    expect(bare.status).toBe(400);
    expect(Object.keys(bare.body.error.fields)).toEqual(expect.arrayContaining(['verification_method', 'evidence_ref']));
    const na = await t.api.patch(`/api/certification-requirements/${r.id}`, { status: 'not_applicable' });
    expect(na.body.error.fields.verification_notes).toBeTruthy();
    const done = ok(await verify(r.id));
    expect(done.verified_by).toBeTruthy();
    expect(done.verified_on).toBeTruthy();
    const reopened = ok(await t.api.patch(`/api/certification-requirements/${r.id}`, { status: 'open' }));
    expect(reopened.verified_by).toBeNull();
    expect(reopened.verified_on).toBeNull();
    // A note is evidence enough.
    expect((await t.api.patch(`/api/certification-requirements/${r.id}`, { status: 'verified', verification_method: 'inspection', verification_notes: 'Inspected on site with the contractor.' })).status).toBe(200);
  });

  it('keeps an item with its project and a requirement within its project', async () => {
    const a = await project('Invented project A');
    const b = await project('Invented project B');
    const ia = await item(a.id);
    const ib = await item(b.id);
    expect((await t.api.patch(`/api/certifiable-items/${ia.id}`, { project_id: b.id })).status).toBe(400);
    const r = await requirement(ia.id);
    expect((await t.api.patch(`/api/certification-requirements/${r.id}`, { item_id: ib.id })).body.error.fields.item_id).toBeTruthy();
    // project_id is the item's, whatever is sent
    const other = await requirement(ia.id, { project_id: b.id });
    expect(other.project_id).toBe(a.id);
  });

  it('derives requirements from hazards and threats; a threat makes the requirement restricted', async () => {
    const p = await project();
    const i = await item(p.id);
    const hazard = ok(await t.api.post('/api/hazards', { title: 'Passenger falls between platform and train', likelihood: 3, severity: 4 }), 201);
    const risk = ok(await t.api.post('/api/risks', { title: 'Tampering with the door controller network', category: 'cyber' }), 201);
    const fromHazard = await requirement(i.id, { source_type: 'hazard', source_id: hazard.id });
    expect(fromHazard.restricted).toBe(false);
    const fromThreat = await requirement(i.id, { title: 'Door controller network is segregated', source_type: 'risk', source_id: risk.id });
    expect(fromThreat.restricted).toBe(true);
    expect((await t.api.post('/api/certification-requirements', { item_id: i.id, title: 'x', source_type: 'vehicle', source_id: hazard.id })).status).toBe(400);
    expect((await t.api.post('/api/certification-requirements', { item_id: i.id, title: 'x', source_type: 'hazard' })).body.error.fields.source_id).toBeTruthy();

    // The admin sees both, with their sources.
    const mine = await certification(p.id);
    const reqs = mine.items[0].requirements;
    expect(reqs.find((r: any) => r.id === fromHazard.id).source).toMatchObject({ type: 'hazard', id: hazard.id, route: `/safety/hazards/${hazard.id}` });
    expect(reqs.find((r: any) => r.id === fromThreat.id).source).toMatchObject({ type: 'risk', id: risk.id });

    // A project manager (no security.view) counts the restricted requirement but sees no detail of it.
    const pm = await t.as('project_manager');
    const theirs = ok(await pm.get(`/api/projects/${p.id}/certification`));
    expect(theirs.summary).toEqual(mine.summary);
    expect([theirs.hidden, mine.hidden]).toEqual([1, 0]);
    const hidden = theirs.items[0].requirements.filter((r: any) => !r.visible);
    expect(hidden).toEqual([{ id: null, ref: null, title: 'A restricted requirement', visible: false, restricted: true, status: 'open' }]);
    expect(JSON.stringify(theirs)).not.toContain('segregated');
    expect((await pm.get(`/api/certification-requirements/${fromThreat.id}`)).status).toBe(404);
    const list = ok(await pm.get(`/api/certification-requirements?f.project_id=${p.id}`));
    expect(list.rows.map((r: any) => r.id)).toEqual([fromHazard.id]);
    // ...and cannot point a requirement at a hazard or threat it cannot see.
    expect((await pm.post('/api/certification-requirements', { item_id: i.id, title: 'y', source_type: 'risk', source_id: risk.id })).status).toBe(400);
  });
});

describe('the certificate of readiness', () => {
  it('cannot be issued while a required item is open, and lists the open items it accepts', async () => {
    const p = await project();
    expect((await issue(p.id)).body.error.code).toBe('nothing_to_certify');
    const doors = await item(p.id);
    const signage = await item(p.id, { name: 'Wayfinding signage', required: false });
    const r = await requirement(doors.id);
    await requirement(signage.id, { title: 'Signs readable at night' });

    let c = await certification(p.id);
    expect(c.blockers.map((b: any) => b.id)).toEqual([doors.id]);
    expect(c.open_items.map((b: any) => b.id)).toEqual([signage.id]);
    expect(c.can_issue).toBe(false);
    const refused = await issue(p.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('certification_open');
    expect(refused.body.error.message).toContain('Platform screen doors');
    expect((await issue(p.id, { scope: '' })).body.error.fields.scope).toBeTruthy();

    ok(await verify(r.id));
    c = await certification(p.id);
    expect(c.blockers).toEqual([]);
    expect(c.can_issue).toBe(true);
    const cert = ok(await issue(p.id, { conditions: 'Signage finished within 30 days.', issued_by_role: 'Chief Safety Officer' }), 201);
    expect(cert.status).toBe('issued');
    expect(cert.open_items.map((i: any) => i.id)).toEqual([signage.id]);
    expect(cert.items).toHaveLength(2);
    expect((await issue(p.id)).body.error.code).toBe('certificate_in_force');

    c = await certification(p.id);
    expect(c.certificate.id).toBe(cert.id);
    const pdf = await t.api.get(`/api/projects/${p.id}/certificates/${cert.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    const history = ok(await t.api.get(`/api/history?record_type=project&record_id=${p.id}`));
    expect(JSON.stringify(history)).toContain('Certificate of readiness issued');
  });

  it('is withdrawn automatically when a required item opens again, and by hand with a reason', async () => {
    const p = await project();
    const doors = await item(p.id);
    const r = await requirement(doors.id);
    ok(await verify(r.id));
    const cert = ok(await issue(p.id), 201);
    // An item that is not required does not withdraw it.
    await item(p.id, { name: 'Bench seating', required: false });
    expect((await certification(p.id)).certificate?.id).toBe(cert.id);
    // A requirement reopened on a required item does.
    ok(await t.api.patch(`/api/certification-requirements/${r.id}`, { status: 'in_progress' }));
    let c = await certification(p.id);
    expect(c.certificate).toBeNull();
    expect(c.history[0]).toMatchObject({ id: cert.id, status: 'withdrawn' });
    expect(c.history[0].withdraw_reason).toContain('Platform screen doors');

    ok(await verify(r.id));
    const again = ok(await issue(p.id), 201);
    // A new required item withdraws it too.
    await item(p.id, { name: 'Traction power interlock' });
    expect((await certification(p.id)).certificate).toBeNull();

    // By hand: needs a reason and projects.approve.
    const p2 = await project();
    ok(await verify((await requirement((await item(p2.id)).id)).id));
    const c2 = ok(await issue(p2.id), 201);
    expect((await t.api.post(`/api/projects/${p2.id}/certificates/${c2.id}/withdraw`, {})).status).toBe(400);
    const viewer = await t.as('executive_viewer');
    expect((await viewer.post(`/api/projects/${p2.id}/certificates/${c2.id}/withdraw`, { reason: 'x' })).status).toBe(403);
    expect((await viewer.post(`/api/projects/${p2.id}/certificates`, { scope: 'x' })).status).toBe(403);
    const w = ok(await t.api.post(`/api/projects/${p2.id}/certificates/${c2.id}/withdraw`, { reason: 'Design change to the doors' }));
    expect(w.status).toBe('withdrawn');
    expect((await t.api.post(`/api/projects/${p2.id}/certificates/${c2.id}/withdraw`, { reason: 'again' })).body.error.code).toBe('not_in_force');
    expect(again.id).toBeTruthy();
  });

  it('a gate whose template requires it blocks approval until one is in force (projects with certifiable items only)', async () => {
    ok(await t.api.patch('/api/projects/gate-definitions/intake', { requires_certificate: true }));
    const defs = ok(await t.api.get('/api/projects/gate-definitions'));
    expect(defs.find((d: any) => d.key === 'intake').requires_certificate).toBe(true);

    // Without certifiable items, the gate is not blocked by it.
    const plain = await project('Invented office move');
    let gates = ok(await t.api.get(`/api/projects/${plain.id}/gates`));
    expect(gates.gates[0].requires_certificate).toBe(true);
    expect(gates.gates[0].blockers.some((b: any) => b.kind === 'certificate')).toBe(false);

    const p = await project();
    const r = await requirement((await item(p.id)).id);
    gates = ok(await t.api.get(`/api/projects/${p.id}/gates`));
    const gate = gates.gates.find((g: any) => g.id === gates.current_gate_id);
    expect(gate.blockers).toContainEqual({ kind: 'certificate', label: 'Certificate of readiness not issued' });
    for (const it of gate.items) ok(await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/items/${it.id}`, { checked: true }));
    for (const n of gate.documents.keys()) ok(await t.api.patch(`/api/projects/${p.id}/gates/${gate.id}/documents/${n}`, { received: true }));
    const portfolio = ok(await t.api.get('/api/projects/portfolio'));
    expect(portfolio.register.find((x: any) => x.id === p.id).gate.ready).toBe(false);
    const blocked = await t.api.post(`/api/projects/${p.id}/gates/${gate.id}/decide`, { decision: 'approved', approver_name: 'A. Tester' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.certificate).toBeTruthy();

    ok(await verify(r.id));
    ok(await issue(p.id), 201);
    gates = ok(await t.api.get(`/api/projects/${p.id}/gates`));
    expect(gates.gates.find((g: any) => g.id === gate.id).blockers).toEqual([]);
    ok(await t.api.post(`/api/projects/${p.id}/gates/${gate.id}/decide`, { decision: 'approved', approver_name: 'A. Tester' }));

    // Switching the template off releases gates that are still open.
    ok(await t.api.patch('/api/projects/gate-definitions/intake', { requires_certificate: false }));
    gates = ok(await t.api.get(`/api/projects/${plain.id}/gates`));
    expect(gates.gates[0].requires_certificate).toBe(false);
  });

  it('puts open requirements in the verifier\'s work', async () => {
    const p = await project();
    const pm = await t.as('project_manager');
    const r = await requirement((await item(p.id)).id, { owner_id: pm.userId, due_on: '2026-01-15' });
    const work = ok(await pm.get('/api/work/mine'));
    expect(JSON.stringify(work)).toContain(r.id);
  });
});

describe('access scope (E41-01)', () => {
  it('items and requirements carry their project\'s department, also when it changes', async () => {
    const dept = async (name: string) => (await t.db.one<{ id: string }>('insert into departments (name) values ($1) returning id', [name]))!.id;
    const a = await dept('Invented rail projects office');
    const b = await dept('Invented bus projects office');
    const p = ok(await t.api.post('/api/projects', { name: 'Invented depot rebuild', department_id: a }), 201);
    const i = await item(p.id);
    const r = await requirement(i.id);
    expect([i.department_id, r.department_id]).toEqual([a, a]);
    // Not writable directly.
    expect(ok(await t.api.patch(`/api/certifiable-items/${i.id}`, { department_id: b })).department_id).toBe(a);
    ok(await t.api.patch(`/api/projects/${p.id}`, { department_id: b }));
    expect(ok(await t.api.get(`/api/certifiable-items/${i.id}`)).department_id).toBe(b);
    expect(ok(await t.api.get(`/api/certification-requirements/${r.id}`)).department_id).toBe(b);
  });
});
