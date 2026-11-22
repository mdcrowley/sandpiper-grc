import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineTaggable } from '../../core/asset-tags.ts';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import type { LookupResponse, LookupResult, TagCard } from '../../../../shared/asset-tags-api.ts';
import { sequenceValue, valueKey } from '../../../../shared/tag-format.ts';

// E37-04 lookup and the tag card, E37-06 actions (TAGS-LOOKUP). Every value, name and record here is
// invented. Fixtures are written straight into the tags tables, so these tests do not depend on how
// formats, stock and attaching are built.

// A restricted taggable type (none of the built-in taggable types is restricted).
const gadgets: ModuleDef = {
  key: 'testgadgets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_gadgets (
        id uuid primary key default gen_random_uuid(), ref text, name text not null, tag_number text, serial text,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'gadget', table: 'test_gadgets', module: 'assets', label: 'Gadget', plural: 'Gadgets',
      path: '/api/gadgets', route: '/gadgets', titleField: 'name', ref: { field: 'ref', prefix: 'GDG-' }, restricted: 'flag',
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        tag_number: { label: 'Tag number', type: 'text' },
        serial: { label: 'Serial number', type: 'text' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    defineTaggable(ctx.app, { type: 'gadget', field: 'tag_number', identifiers: [{ field: 'serial', label: 'Serial number' }], siteField: null });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let agent: Client;
let manager: Client;
let safety: Client;
let outsider: Client;
let adminCookie = '';
const ids: Record<string, string> = {};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const TA = (n: number) => sequenceValue(n, { prefix: 'TA-', digits: 5, checkCharacter: 'mod10' });

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

/** Writes an assignment straight into the table (an active one only when the value is not already active). */
async function assign(type: string, id: string, value: string, status = 'active', replacedBy: string | null = null): Promise<string> {
  const key = valueKey(value);
  if (status === 'active') {
    const there = await t.db.one<{ id: string; record_id: string }>(`select id, record_id from tag_assignments where value_key = $1 and status = 'active'`, [key]);
    if (there) return there.id;
  }
  const row = await t.db.one<{ id: string }>(
    `insert into tag_assignments (value, value_key, record_type, record_id, status, is_primary, source, replaced_by, ended_at)
     values ($1, $2, $3, $4, $5, true, 'typed', $6, case when $5 = 'active' then null else now() end) returning id`,
    [value, key, type, id, status, replacedBy]);
  return row!.id;
}

async function inStock(values: string[]): Promise<void> {
  const range = await t.db.one<{ id: string }>(`insert into tag_ranges (kind, source, supplier_note) values ('list', 'bought', 'Invented test box') returning id`);
  for (const v of values) await t.db.query('insert into tag_range_values (range_id, value, value_key) values ($1, $2, $3)', [range!.id, v, valueKey(v)]);
}

async function lookup(client: { get: Client['get'] }, value: string, source = 'typed'): Promise<LookupResult> {
  const res = await client.get(`/api/asset-tags/lookup?${new URLSearchParams({ value, source })}`);
  expect(res.status).toBe(200);
  return (res.body as LookupResponse).results[0];
}
const keys = (card: TagCard) => card.actions.map((a) => a.key);

/** What an answer looks like with the value itself taken out, to compare answers for different values. */
function shape(r: LookupResult) {
  return { ...r, candidate: null, key: null, message: r.message.replace(r.candidate.value, '<value>') };
}

async function setFeatures(features: Record<string, boolean>) {
  const res = await t.api.patch('/api/admin/features', { features });
  expect(res.status).toBe(200);
  await t.api.get('/api/auth/state');
}

beforeAll(async () => {
  process.env.GRC_MODULES ??= 'admin,tags,inventory,fleet,tickets,safety,condition,audits,attachments,portal,notifications,risks,workflows';
  t = await testApp({ extraModules: [gadgets] });
  // Confirmation for switching areas (sensitive administration).
  await t.api.post('/api/auth/confirm', { password: 'a long test passphrase 1' });
  const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  ids.adminUser = admin!.id;
  adminCookie = await createSession(t.db, admin!.id);
  agent = await t.as('agent');
  manager = await t.as('asset_manager');
  safety = await withGrants('tag_safety_test', ['safety.*', 'assets.view', 'sites.view', 'fleet.view']);
  outsider = await withGrants('tag_outsider_test', ['policies.view']);

  ids.depot = (await t.api.post('/api/sites', { name: 'Test Depot North' })).body.id;
  const laptop = await t.api.post('/api/assets', { name: 'Test rugged tablet', serial: 'SN-77Q-4410', site_id: ids.depot, location: 'Dispatch desk 2', user_id: ids.adminUser });
  expect(laptop.status).toBe(201);
  ids.asset = laptop.body.id;
  ids.system = (await t.api.post('/api/systems', { name: 'Test fare gate controller' })).body.id;
  const bus = await t.api.post('/api/vehicles', { fleet_number: 'T-4471', mode: 'bus', depot_id: ids.depot });
  expect(bus.status).toBe(201);
  ids.vehicle = bus.body.id;
  ids.gadget = (await t.api.post('/api/gadgets', { name: 'Test hidden gadget', restricted: true, serial: 'GZ-1188' })).body.id;
  ids.openGadget = (await t.api.post('/api/gadgets', { name: 'Test open gadget' })).body.id;

  await assign('asset', ids.asset, 'K7Q2M9');
  await assign('system', ids.system, 'SB-004512');
  await assign('vehicle', ids.vehicle, 'VH-20391');
  await assign('gadget', ids.gadget, 'GH-55120');
  // A value attached and then ended (removed from a record).
  await assign('asset', ids.asset, 'XE-90001', 'ended');
  // A replaced value: the system's earlier tag.
  const now = await t.db.one<{ id: string }>(`select id from tag_assignments where value_key = 'SB004512'`);
  await assign('system', ids.system, 'SB-000777', 'replaced', now!.id);
});
afterAll(async () => { await t.close(); });

describe('looking up a value (spec §4.2)', () => {
  it('finds a current tag, compared by its comparison form, with the tag card', async () => {
    const r = await lookup(t.api, ' k7q-2m9 ');
    expect(r.outcome).toBe('current');
    expect(r.key).toBe('K7Q2M9');
    expect(r.cards).toHaveLength(1);
    const card = r.cards[0];
    expect(card).toMatchObject({ recordType: 'asset', typeLabel: 'Asset', recordId: ids.asset, route: `/assets/${ids.asset}`, title: 'Test rugged tablet', tagValue: 'K7Q2M9', location: 'Dispatch desk 2' });
    expect(card.tagValues).toContain('K7Q2M9');
    expect(card.site).toMatchObject({ type: 'site', id: ids.depot, label: 'Test Depot North', route: `/sites/${ids.depot}` });
    expect(card.people.map((p) => p.name)).toContain('Test Admin');
    expect(card.version).toMatch(/^".+"$/);
    expect(card.activity.recentChanges.length).toBeGreaterThan(0);
    expect(card.holds).toEqual([]);
    expect(keys(card)).toContain('open');
  });

  it('finds a replaced value with a notice naming the new one', async () => {
    const r = await lookup(t.api, 'SB-000777');
    expect(r.outcome).toBe('replaced');
    expect(r.replacedBy).toBe('SB-004512');
    expect(r.message).toContain('replaced by SB-004512');
    expect(r.cards[0].recordId).toBe(ids.system);
  });

  it('says a value in stock is not attached yet, offering Attach only to people who manage tags', async () => {
    await inStock(['BX-010001', 'BX-010002']);
    const r = await lookup(t.api, 'bx 010001');
    expect(r.outcome).toBe('in_stock');
    expect(r.message).toBe('Tag bx 010001 is not attached yet.');
    expect(r.actions).toEqual([expect.objectContaining({ key: 'attach', value: 'bx 010001' })]);
    expect((await lookup(manager, 'BX-010001')).actions.map((a) => a.key)).toEqual(['attach']);
    expect((await lookup(agent, 'BX-010001')).actions).toEqual([]);
  });

  it('finds other identifiers exactly, among records the person may see', async () => {
    const r = await lookup(agent, 'sn77q4410');
    expect(r.outcome).toBe('identifier');
    expect(r.matchedBy).toBe('Serial number');
    expect(r.cards.map((c) => c.recordId)).toEqual([ids.asset]);
    const bus = await lookup(agent, 'T 4471');
    expect(bus).toMatchObject({ outcome: 'identifier', matchedBy: 'Fleet number' });
    // Not a prefix or a partial match.
    expect((await lookup(agent, 'SN-77Q-441')).outcome).toBe('nothing');
  });

  it('answers nothing for a value nobody has', async () => {
    const r = await lookup(agent, 'QQ-404404');
    expect(r).toMatchObject({ outcome: 'nothing', message: 'Nothing found for QQ-404404.', cards: [], actions: [], replacedBy: null });
    expect(r.switchedOff).toBeUndefined();
  });

  it('takes up to ten candidates in one POST, one result each in order, and counts the records found', async () => {
    const res = await t.api.post('/api/asset-tags/lookup', { candidates: [
      { value: 'K7Q2M9', source: 'code' }, { value: 'K7Q2MS', source: 'text' }, { value: 'SB-004512', source: 'text' }, { value: 'K7Q-2M9', source: 'typed' },
    ] });
    expect(res.status).toBe(200);
    const body = res.body as LookupResponse;
    expect(body.results.map((r) => r.outcome)).toEqual(['current', 'nothing', 'current', 'current']);
    expect(body.records).toBe(2);
    expect((await t.api.post('/api/asset-tags/lookup', { candidates: [] })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ value: `V${i}00`, source: 'text' }));
    expect((await t.api.post('/api/asset-tags/lookup', { candidates: eleven })).status).toBe(400);
    expect((await t.api.post('/api/asset-tags/lookup', { candidates: [{ value: 'K7Q2M9', source: 'telepathy' }] })).status).toBe(400);
    // The web's GET takes typed or handheld only.
    expect((await t.api.get('/api/asset-tags/lookup?value=K7Q2M9&source=code')).status).toBe(400);
    expect((await t.api.get('/api/asset-tags/lookup?value=')).status).toBe(400);
    expect((await lookup(t.api, 'K7Q2M9', 'handheld')).outcome).toBe('current');
  });
});

describe('identical answers (E37-04): unknown, restricted, not permitted, switched off, ended', () => {
  it('answers a hidden, ended or unknown value exactly alike, and never ties the log to a hidden record', async () => {
    const unknown = shape(await lookup(agent, 'GH-55999'));
    expect(unknown.outcome).toBe('nothing');
    // Restricted (the agent has no security.view): the gadget's tag.
    expect(shape(await lookup(agent, 'GH-55120'))).toEqual(unknown);
    // Its serial number too (rule 5 is limited to records the person may see).
    expect(shape(await lookup(agent, 'GZ-1188'))).toEqual(unknown);
    // Not permitted: someone who may not see assets at all.
    expect(shape(await lookup(outsider, 'K7Q2M9'))).toEqual(shape(await lookup(outsider, 'GH-55999')));
    expect(shape(await lookup(outsider, 'K7Q2M9'))).toEqual(unknown);
    // Ended: the value was removed from its record.
    expect(shape(await lookup(agent, 'XE-90001'))).toEqual(unknown);
    // The administrator sees the restricted record.
    expect((await lookup(t.api, 'GH-55120')).outcome).toBe('current');

    const logged = await t.db.query<{ record_id: string | null }>(`select record_id from tag_lookups where value_key = 'GH55120' order by at`);
    if (logged.length) {
      // Logging on (default): the agent's lookups are logged without the record, the administrator's with it.
      expect(logged.slice(0, -1).every((r) => r.record_id === null)).toBe(true);
      expect(logged.at(-1)!.record_id).toBe(ids.gadget);
    }
  });

  it('answers a switched-off area alike, telling administrators only', async () => {
    await setFeatures({ fleet: false });
    try {
      const unknown = shape(await lookup(agent, 'VH-99999'));
      expect(shape(await lookup(agent, 'VH-20391'))).toEqual(unknown);
      const admin = await lookup(t.api, 'VH-20391');
      expect(admin.outcome).toBe('nothing');
      expect(admin.switchedOff).toBe(true);
      expect((await lookup(t.api, 'VH-99999')).switchedOff).toBeUndefined();
      // The fleet number of a vehicle is no identifier while fleet is off.
      expect((await lookup(t.api, 'T-4471')).outcome).toBe('nothing');
    } finally {
      await setFeatures({ fleet: true });
    }
  });

  it('with a format: a hidden value matching it answers like an unknown one that matches it', async () => {
    const fmt = await t.db.one<{ id: string }>(
      `insert into tag_formats (name, characters, prefix, length_min, length_max, check_character) values ('Test bought tags', 'digits', 'TA-', 6, 6, 'mod10') returning id`);
    try {
      await assign('gadget', ids.gadget, TA(11834));
      await assign('asset', ids.asset, TA(22001), 'ended');
      const unknown = shape(await lookup(agent, TA(30303)));
      expect(unknown).toMatchObject({ outcome: 'unknown_format', formatId: fmt!.id, actions: [] });
      expect(shape(await lookup(agent, TA(11834)))).toEqual(unknown);
      expect(shape(await lookup(agent, TA(22001)))).toEqual(unknown);
      // Attach is offered to people who manage tags.
      expect((await lookup(manager, TA(30303))).actions.map((a) => a.key)).toEqual(['attach']);
      // A check character that does not match is a misread, refused before any lookup.
      const good = TA(11834);
      const bad = `${good.slice(0, -1)}${(Number(good.slice(-1)) + 1) % 10}`;
      const misread = await lookup(t.api, bad);
      expect(misread.outcome).toBe('misread');
      expect(misread.cards).toEqual([]);
    } finally {
      await t.db.query('update tag_formats set active = false where id = $1', [fmt!.id]);
    }
  });

  it('takes the value out of a code that holds more, with a format\'s extraction pattern', async () => {
    const fmt = await t.db.one<{ id: string }>(
      `insert into tag_formats (name, characters, prefix, extract_pattern) values ('Test code wrapper', 'alphanumeric', '', 'ID=(\\w+);') returning id`);
    try {
      const r = (await t.api.post('/api/asset-tags/lookup', { candidates: [{ value: 'SUP-7;ID=K7Q2M9;LOT=4', source: 'code' }] })).body.results[0];
      expect(r).toMatchObject({ outcome: 'current', key: 'K7Q2M9' });
    } finally {
      await t.db.query('update tag_formats set active = false where id = $1', [fmt!.id]);
    }
  });

  it('answers 404 switched_off while the Asset tags area is off', async () => {
    await setFeatures({ tags: false });
    try {
      const res = await t.api.get('/api/asset-tags/lookup?value=K7Q2M9');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('switched_off');
    } finally {
      await setFeatures({ tags: true });
    }
  });
});

describe('actions on the card (E37-06)', () => {
  it('lists what each role may do, in order', async () => {
    const admin = (await lookup(t.api, 'K7Q2M9')).cards[0];
    expect(keys(admin)).toEqual(['report_problem', 'report_hazard', 'edit', 'quick_update', 'add_photo', 'add_note', 'record_condition', 'replace_tag', 'open']);
    const forAgent = (await lookup(agent, 'K7Q2M9')).cards[0];
    // The agent holds tickets.* and assets.* but no safety, condition (assets.create yes: condition is assets), or tag management.
    expect(keys(forAgent)).toEqual(['report_problem', 'edit', 'quick_update', 'add_photo', 'add_note', 'record_condition', 'open']);
    const forManager = (await lookup(manager, 'K7Q2M9')).cards[0];
    expect(keys(forManager)).toEqual(['edit', 'quick_update', 'add_photo', 'add_note', 'record_condition', 'replace_tag', 'open']);
    const forSafety = (await lookup(safety, 'K7Q2M9')).cards[0];
    expect(keys(forSafety)).toEqual(['report_hazard', 'add_note', 'open']);
  });

  it('prefills a ticket with the record as the affected asset or system, and links a site or vehicle', async () => {
    const card = (await lookup(agent, 'K7Q2M9')).cards[0];
    const report = card.actions.find((a) => a.key === 'report_problem')!;
    expect(report.prefill).toMatchObject({ type: 'ticket', path: '/api/tickets', values: { asset_id: ids.asset, type: 'incident' } });
    const made = await agent.post(report.prefill!.path, { ...report.prefill!.values, title: 'Screen cracked' });
    expect(made.status).toBe(201);
    expect(made.body.asset_id).toBe(ids.asset);
    // The open ticket shows on the card.
    expect((await lookup(agent, 'K7Q2M9')).cards[0].activity.openTickets.map((x) => x.id)).toContain(made.body.id);

    const sys = (await lookup(agent, 'SB-004512')).cards[0].actions.find((a) => a.key === 'report_problem')!;
    expect(sys.prefill!.values).toMatchObject({ system_id: ids.system });
    const bus = (await lookup(agent, 'VH-20391')).cards[0].actions.find((a) => a.key === 'report_problem')! as any;
    expect(bus.prefill.link).toEqual({ type: 'vehicle', id: ids.vehicle });
    const viaLink = await agent.post('/api/tickets', { ...bus.prefill.values });
    expect(viaLink.status).toBe(201);
    expect((await agent.post('/api/links', { from_type: 'ticket', from_id: viaLink.body.id, to_type: 'vehicle', to_id: ids.vehicle })).status).toBe(201);
    expect((await lookup(agent, 'VH-20391')).cards[0].activity.openTickets.map((x) => x.id)).toContain(viaLink.body.id);
  });

  it('sends requesters to the portal form when the portal is on', async () => {
    const requester = await withGrants('tag_requester_test', ['portal.view', 'portal.create', 'assets.view', 'sites.view']);
    expect(keys((await lookup(requester, 'K7Q2M9')).cards[0])).toEqual(['add_note', 'open']);
    await setFeatures({ portal: true });
    try {
      const card = (await lookup(requester, 'K7Q2M9')).cards[0];
      const report = card.actions.find((a) => a.key === 'report_problem')!;
      expect(report.webPath).toMatch(/^\/portal\/report\?what=/);
      expect(new URLSearchParams(report.webPath!.split('?')[1]).get('where')).toContain('Test rugged tablet');
      expect(report.prefill).toMatchObject({ type: 'ticket', path: '/api/portal/requests' });
      const hazard = card.actions.find((a) => a.key === 'report_hazard')!;
      expect(hazard.webPath).toMatch(/^\/portal\/safety\?where=/);
    } finally {
      await setFeatures({ portal: false });
    }
  });

  it('prefills a safety report at the record\'s site with the record linked', async () => {
    const hazard = (await lookup(safety, 'K7Q2M9')).cards[0].actions.find((a) => a.key === 'report_hazard')! as any;
    expect(hazard.prefill).toMatchObject({ type: 'safety_event', path: '/api/safety-events', values: { site_id: ids.depot, event_type: 'unsafe_condition' } });
    expect(hazard.prefill.link).toEqual({ type: 'asset', id: ids.asset });
    const made = await safety.post(hazard.prefill.path, hazard.prefill.values);
    expect(made.status).toBe(201);
    expect(made.body.site_id).toBe(ids.depot);
    const bus = (await lookup(safety, 'VH-20391')).cards[0].actions.find((a) => a.key === 'report_hazard')! as any;
    expect(bus.prefill.values).toMatchObject({ vehicle_id: ids.vehicle, site_id: ids.depot });
    expect(bus.prefill.link).toBeNull();
  });

  it('quick updates go through the normal update path with If-Match', async () => {
    const card = (await lookup(agent, 'K7Q2M9')).cards[0];
    const quick = card.actions.find((a) => a.key === 'quick_update')!;
    expect(quick.fields!.map((f) => f.field)).toEqual(['status', 'site_id', 'location', 'user_id', 'owner_id']);
    expect(quick.fields!.find((f) => f.field === 'site_id')).toMatchObject({ type: 'ref', to: 'site', value: ids.depot, display: expect.stringContaining('Test Depot North') });
    const patch = (ifMatch: string, body: object) => t.app.inject({
      method: 'PATCH', url: `/api/assets/${ids.asset}`, payload: body,
      headers: { cookie: `${SESSION_COOKIE}=${adminCookie}`, 'x-grc-csrf': '1', 'if-match': ifMatch },
    });
    const ok = await patch(card.version, { location: 'Dispatch desk 3' });
    expect(ok.statusCode).toBe(200);
    const stale = await patch(card.version, { location: 'Dispatch desk 4' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('version_conflict');
    const again = (await lookup(agent, 'K7Q2M9')).cards[0];
    expect(again.location).toBe('Dispatch desk 3');
    expect(again.version).not.toBe(card.version);
  });

  it('leaves out changes to a record under a legal hold', async () => {
    const hold = await t.db.one<{ id: string }>(`insert into legal_holds (ref, matter, status) values ('LGH-09901', 'Invented test matter', 'active') returning id`);
    await t.db.query(`insert into legal_hold_records (hold_id, record_type, record_id) values ($1, 'system', $2)`, [hold!.id, ids.system]);
    try {
      const admin = (await lookup(t.api, 'SB-004512')).cards[0];
      expect(admin.holds).toEqual([{ ref: 'LGH-09901' }]);
      expect(keys(admin)).not.toContain('edit');
      expect(keys(admin)).not.toContain('quick_update');
      expect(keys(admin)).not.toContain('replace_tag');
      expect(keys(admin)).toEqual(expect.arrayContaining(['report_problem', 'add_note', 'open']));
      // People who may not see holds get no reference, and the same actions.
      const forAgent = (await lookup(agent, 'SB-004512')).cards[0];
      expect(forAgent.holds).toEqual([]);
      expect(keys(forAgent)).not.toContain('edit');
    } finally {
      await t.db.query(`update legal_holds set status = 'released' where id = $1`, [hold!.id]);
    }
    expect(keys((await lookup(t.api, 'SB-004512')).cards[0])).toContain('edit');
  });

  it('follows switched-off areas: no ticket, hazard or condition actions while those areas are off', async () => {
    await setFeatures({ tickets: false, safety: false, condition: false });
    try {
      const card = (await lookup(t.api, 'K7Q2M9')).cards[0];
      expect(keys(card)).not.toContain('report_problem');
      expect(keys(card)).not.toContain('report_hazard');
      expect(keys(card)).not.toContain('record_condition');
      expect(card.facts.map((f) => f.field)).not.toContain('condition_rating');
      expect(card.activity.openTickets).toEqual([]);
    } finally {
      await setFeatures({ tickets: true, safety: true, condition: true });
    }
    const back = (await lookup(t.api, 'K7Q2M9')).cards[0];
    expect(back.facts.map((f) => f.field)).toContain('condition_rating');
  });

  it('records condition through the prefilled assessment', async () => {
    const act = (await lookup(t.api, 'K7Q2M9')).cards[0].actions.find((a) => a.key === 'record_condition')!;
    expect(act.prefill).toMatchObject({ type: 'condition_assessment', values: { target_type: 'asset', target_id: ids.asset } });
    const made = await t.api.post(act.prefill!.path, { ...act.prefill!.values, rating: '4' });
    expect(made.status).toBe(201);
    expect((await lookup(t.api, 'K7Q2M9')).cards[0].activity.lastCondition?.id).toBe(made.body.id);
    // Systems cannot be rated.
    expect(keys((await lookup(t.api, 'SB-004512')).cards[0])).not.toContain('record_condition');
  });

  it('starts an inspection when a checklist applies, and opens the open one when there is one', async () => {
    expect(keys((await lookup(t.api, 'K7Q2M9')).cards[0])).not.toContain('start_inspection');
    const tpl = await t.api.post('/api/checklist-templates', { name: 'Test tablet check', kind: 'inspection', target_type: 'asset' });
    expect(tpl.status).toBe(201);
    const start = (await lookup(t.api, 'K7Q2M9')).cards[0].actions.find((a) => a.key === 'start_inspection')!;
    expect(start.prefill).toMatchObject({ type: 'inspection', values: { target_type: 'asset', target_id: ids.asset, template_id: tpl.body.id } });
    const made = await t.api.post(start.prefill!.path, start.prefill!.values);
    expect(made.status).toBe(201);
    const again = (await lookup(t.api, 'K7Q2M9')).cards[0].actions.find((a) => a.key === 'start_inspection')!;
    expect(again).toMatchObject({ prefill: null, webPath: `/inspections/${made.body.id}/run` });
    expect((await lookup(t.api, 'K7Q2M9')).cards[0].activity.lastInspection?.id).toBe(made.body.id);
    await setFeatures({ audits: false });
    try {
      expect(keys((await lookup(t.api, 'K7Q2M9')).cards[0])).not.toContain('start_inspection');
    } finally {
      await setFeatures({ audits: true });
    }
  });

  it('offers Count it while an open count waits for the record', async () => {
    const count = await t.db.one<{ id: string }>(`insert into inventory_counts (ref, title, site_id) values ('CNT-09901', 'Test count', $1) returning id`, [ids.depot]);
    await t.db.query(`insert into inventory_count_items (count_id, record_type, record_id, expected) values ($1, 'asset', $2, true)`, [count!.id, ids.asset]);
    try {
      const forAgent = (await lookup(agent, 'K7Q2M9')).cards[0].actions.find((a) => a.key === 'count');
      expect(forAgent).toMatchObject({ countId: count!.id, webPath: `/inventory-counts/${count!.id}` });
      // Without tags.count, no Count it.
      expect(keys((await lookup(safety, 'K7Q2M9')).cards[0])).not.toContain('count');
    } finally {
      await t.db.query(`update inventory_counts set status = 'finished' where id = $1`, [count!.id]);
    }
    expect(keys((await lookup(agent, 'K7Q2M9')).cards[0])).not.toContain('count');
  });

  it('adds a photo and a note, and marks one picture as the record\'s photo on the card', async () => {
    const upload = (name: string, body: Buffer) => t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'asset', record_id: ids.asset, name })}`,
      headers: { cookie: `${SESSION_COOKIE}=${adminCookie}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: body,
    });
    const pic = await upload('front.png', PNG);
    expect(pic.statusCode).toBe(201);
    const doc = await upload('notes.txt', Buffer.from('Invented notes about the tablet.'));
    expect(doc.statusCode).toBe(201);

    const refused = await t.api.put('/api/asset-tags/photo', { recordType: 'asset', recordId: ids.asset, attachmentId: doc.json().id });
    expect(refused.status).toBe(400);
    expect((await safety.put('/api/asset-tags/photo', { recordType: 'asset', recordId: ids.asset, attachmentId: pic.json().id })).status).toBe(403);
    expect((await outsider.put('/api/asset-tags/photo', { recordType: 'asset', recordId: ids.asset, attachmentId: pic.json().id })).status).toBe(404);
    const set = await t.api.put('/api/asset-tags/photo', { recordType: 'asset', recordId: ids.asset, attachmentId: pic.json().id });
    expect(set.status).toBe(200);
    expect(set.body.photo).toMatchObject({ attachmentId: pic.json().id, url: `/api/attachments/${pic.json().id}/download` });
    expect((await lookup(agent, 'K7Q2M9')).cards[0].photo?.attachmentId).toBe(pic.json().id);
    const audit = await t.db.one<{ n: string }>(`select count(*)::text as n from audit_events where action = 'tag.photo' and record_id = $1`, [ids.asset]);
    expect(Number(audit!.n)).toBe(1);

    // A removed file is no longer shown.
    expect((await t.api.del(`/api/attachments/${pic.json().id}`)).status).toBe(200);
    expect((await lookup(agent, 'K7Q2M9')).cards[0].photo).toBeNull();

    // A note is a comment on the record, open to anyone who may see it.
    expect(keys((await lookup(safety, 'K7Q2M9')).cards[0])).toContain('add_note');
    expect((await safety.post('/api/comments', { record_type: 'asset', record_id: ids.asset, body: 'Seen at dispatch, screen cracked.' })).status).toBe(201);
  });

  it('lists the taggable types the person may see', async () => {
    const types = (await agent.get('/api/asset-tags/taggables')).body as { type: string; canEdit: boolean }[];
    expect(types.map((x) => x.type)).toEqual(expect.arrayContaining(['asset', 'site', 'system', 'vehicle']));
    expect(types.every((x) => x.canEdit)).toBe(true);
    expect((await outsider.get('/api/asset-tags/taggables')).body).toEqual([]);
  });
});
