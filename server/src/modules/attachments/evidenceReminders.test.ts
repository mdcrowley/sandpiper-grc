import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { ownerField, runEvidenceFileReminders } from './evidenceReminders.ts';

// Evidence files about to expire remind the record's owner (E14-18). Invented record types.
const sent: any[] = [];
const fixtures: ModuleDef = {
  key: 'testevidence',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_audits (
        id uuid primary key default gen_random_uuid(), title text not null, owner_id uuid,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_drills (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    // Stands in for the notifications module, keeping its "once" rule.
    const seen = new Set<string>();
    if (!ctx.app.hasDecorator('notify')) {
      (ctx.app as any).decorate('notify', async (input: any) => {
        const users = (input.userIds ?? []).filter((u: string | null) => u && !seen.has(`${u}:${input.once}`));
        for (const u of users) { seen.add(`${u}:${input.once}`); sent.push({ ...input, userId: u }); }
        return { sent: users.length, skipped: 0 };
      });
    }
    ctx.defineResource({
      type: 'audit_check', table: 'test_audits', module: 'tickets', label: 'Audit check', plural: 'Audit checks',
      path: '/api/audit-checks', route: '/audit-checks', titleField: 'title', evidence: true,
      fields: { title: { label: 'Title', type: 'text', required: true }, owner_id: { label: 'Owner', type: 'user' } },
    });
    ctx.defineResource({
      type: 'drill', table: 'test_drills', module: 'tickets', label: 'Drill', plural: 'Drills',
      path: '/api/drills', route: '/drills', titleField: 'title', evidence: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);
const day = (offset: number) => todayInZone(new Date(Date.now() + offset * 86_400_000));

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';
let ownerId = '';
const before = process.env.GRC_MODULES;

async function attach(type: string, id: string, name: string, expires: string) {
  const token = await createSession(t.db, adminId);
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: type, record_id: id, name, kind: 'evidence', collected_on: day(-100), expires_on: expires })}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: PDF,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'attachments';
  t = await testApp({ extraModules: [fixtures] });
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  ownerId = (await t.as('agent')).userId;
});
afterAll(async () => {
  await t.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

describe('evidence file reminders', () => {
  it('finds the owner field', () => {
    expect(ownerField(t.core.resources.registry.get('audit_check')!)).toBe('owner_id');
    expect(ownerField(t.core.resources.registry.get('drill')!)).toBeNull();
  });

  it('reminds the owner once per step, only the nearest step, and the uploader when there is no owner', async () => {
    const check = (await t.api.post('/api/audit-checks', { title: 'Depot fire check', owner_id: ownerId })).body.id;
    const drill = (await t.api.post('/api/drills', { title: 'Evacuation drill' })).body.id;
    const soon = await attach('audit_check', check, 'Extinguisher service.pdf', day(20));
    const late = await attach('drill', drill, 'Drill sign-in sheet.pdf', day(5));
    await attach('audit_check', check, 'Far away.pdf', day(200));

    const r = await runEvidenceFileReminders(t.ctx);
    expect(r.sent).toBe(2);
    const first = sent.find((s) => s.title.includes('Extinguisher'));
    expect(first).toMatchObject({ userId: ownerId, kind: 'reminder', recordType: 'audit_check', recordId: check, route: `/audit-checks/${check}?tab=attachments` });
    expect(first.title).toBe('Evidence file expires in 20 days: Extinguisher service.pdf');
    expect(first.once).toBe(`attachments.evidence_expiry:${soon}:${day(20)}:30`);
    const second = sent.find((s) => s.title.includes('Drill sign-in'));
    expect(second).toMatchObject({ userId: adminId, once: `attachments.evidence_expiry:${late}:${day(5)}:7` });

    // Again the same day: nothing new.
    expect((await runEvidenceFileReminders(t.ctx)).sent).toBe(0);
    // On the day it expires: the last step.
    expect((await runEvidenceFileReminders(t.ctx, day(5))).sent).toBe(1);
    expect(sent.at(-1).title).toBe('Evidence file expires today: Drill sign-in sheet.pdf');
  });
});
