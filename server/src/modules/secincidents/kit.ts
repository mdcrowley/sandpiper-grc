import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import { featureState, optionName, optionOn } from '../../core/features.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { addressLine, organizationName, printBranding, readOrganization, type PrintBranding } from '../../core/organization.ts';
import { dayInZone, TIME_ZONE } from '../../core/timezone.ts';
import { stamp } from './clocks.ts';
import { incidentQuestions, triggerOptions } from './defaults.ts';

// The offline incident kit (E09-14) and its stored PDF copies (E09-16).
//
// The kit exists for the day the network or this application is down, so a copy has to be
// somewhere else before that day. The server renders it to PDF on a schedule and after any change
// to what it contains (checked every 15 minutes through the job queue), and on demand. Copies are
// kept in the database (so they are in every backup) for people with security.view and
// security.export to download and print.
//
// Optionally each automatic copy is emailed, as an attachment, to people an administrator names:
// a copy in their mailbox, or printed from it, is what survives an outage of this application. The
// kit holds only standing material (notification rules, contacts, checklists, severity guide) and
// never an incident record, and every part of it is visible to anyone with security.view; so a
// recipient must still hold security.view and security.export when each email is sent, and anyone
// who no longer does is skipped. Email is used only when an administrator has switched it on.

const MINUTE = 60_000;
const DAY = 86_400_000;
/** How often the job looks for changes: a change reaches a new copy within this time. */
export const KIT_CHECK_MS = 15 * MINUTE;
export const KIT_SETTINGS = { everyDays: 'security.kit_every_days', recipients: 'security.kit_recipients', keep: 'security.kit_keep' } as const;
export const DEFAULT_KIT_EVERY_DAYS = 7;
export const DEFAULT_KIT_KEEP = 12;

export type KitReason = 'first' | 'schedule' | 'change' | 'on_demand';
const REASONS: Record<KitReason, string> = {
  first: 'First copy', schedule: 'Scheduled copy', change: 'Contents changed', on_demand: 'Made on request',
};

export interface Kit {
  generated_at: string;
  generated_by: string;
  rules: Row[];
  questions: Row[];
  contacts: Row[];
  checklists: { scenario: string; label: string; containment: string[]; recovery: string[] }[];
  severities: Row[];
  /** The ransom rule as this installation has set it up (the "ransom_approval" option). */
  ransom_approval: { on: boolean; name: string };
  /** The organization and its security contact (Administration > Organization); empty strings when not set. */
  organization: { name: string; address: string; phone: string; security_phone: string; security_email: string };
}

/** Everything the kit prints, read fresh. `by` is who it is produced for or by. */
export async function loadKit(ctx: ModuleContext, by: string): Promise<Kit> {
  const { db } = ctx;
  const rules = await db.query<Row>(
    `select id, trigger_attribute, party, deadline_hours, required, guidance, active from notification_rules
     where deleted_at is null order by sort, party`,
  );
  const triggers = await triggerOptions(ctx);
  const contacts = await db.query<Row>(
    `select id, role, person_name, contact, notes from incident_contacts where deleted_at is null order by sort, role`,
  );
  const templates = await db.query<Row>(
    `select scenario, phase, step from incident_checklist_templates where deleted_at is null and active order by scenario, phase, sort`,
  );
  const scenarios = await ctx.lookups.values('security_incident_scenario');
  const checklists = scenarios.map((s) => ({
    scenario: s.value, label: s.label,
    containment: templates.filter((t) => t.scenario === s.value && t.phase === 'containment').map((t) => String(t.step)),
    recovery: templates.filter((t) => t.scenario === s.value && t.phase === 'recovery').map((t) => String(t.step)),
  })).filter((c) => c.containment.length || c.recovery.length);
  const state = await featureState(db);
  const org = await readOrganization(db);
  return {
    generated_at: new Date().toISOString(),
    generated_by: by,
    rules: rules.map((r) => ({ ...r, trigger_label: triggers.find((t) => t.value === r.trigger_attribute)?.label ?? r.trigger_attribute })),
    questions: await incidentQuestions(ctx),
    contacts,
    checklists,
    severities: await ctx.lookups.values('security_incident_severity'),
    ransom_approval: { on: optionOn(state, 'ransom_approval'), name: optionName(state, 'ransom_approval') },
    organization: {
      name: organizationName(org), address: addressLine(org), phone: org.phone,
      security_phone: org.securityPhone, security_email: org.securityEmail,
    },
  };
}

/** A fingerprint of what the kit says (not when or for whom it was made): equal fingerprints print the same kit. */
export function kitFingerprint(kit: Kit): string {
  const { generated_at: _at, generated_by: _by, ...contents } = kit;
  return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}

export function deadlineText(hours: unknown): string {
  if (hours === null || hours === undefined) return 'No deadline set';
  const h = Number(hours);
  if (h === 0) return 'Immediately';
  if (h % 24 === 0 && h >= 48) return `${h / 24} days`;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

const BOX = '[   ]';
const BLANK = '__________________________';

/**
 * The kit as a PDF: a cover, then one section per page, in the order of the printed screen. The
 * time it was made is printed at the top of every page (with the restricted marking), so a sheet
 * found on its own still says how old it is.
 */
export async function renderKitPdf(kit: Kit, appName: string, branding: PrintBranding | null = null): Promise<{ pdf: Buffer; made: string }> {
  const made = `${stamp(kit.generated_at)} (${TIME_ZONE})`;
  const isOn = (r: Row) => r.active && r.deadline_hours !== null;
  const active = kit.rules.filter(isOn);
  const other = kit.rules.filter((r) => !isOn(r));
  const contents = [
    'First hour', 'Incident roles and contacts', 'Who must be told, and by when', 'Severity guide and ransom rule',
    ...(kit.checklists.length ? kit.checklists.map((c) => `Checklist: ${c.label}`) : ['Scenario checklists']),
    'Notification record sheet', 'Incident log sheets',
  ];
  const pdf = new PdfBuilder({
    title: 'Security incident kit',
    subtitle: 'What to do, who to call and who must be told when the network or this system is down.',
    meta: [`Produced ${made}`, `Produced by ${kit.generated_by}`, `This copy is kept by: ${BLANK}`],
    watermark: `Restricted security record · Produced ${made} · Reprint after any change`,
    appName, cover: true, author: appName, branding,
  });
  const page = (title: string, n: number) => {
    if (n > 1) pdf.newPage();
    pdf.heading(`${n}. ${title}`);
  };

  // Contents, on the first body page with the first hour.
  pdf.heading('In this kit', 2);
  pdf.markdown(contents.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  pdf.paragraph('Reprint after any change to the notification rules, the contacts or the checklists, and destroy the old copies. Keep one copy in a locked cabinet and one with each member of the incident team.', { muted: true });

  page('First hour', 1);
  pdf.markdown([
    '1. **Write down the time** the organization first became aware. Every notification deadline counts from that discovery time.',
    '2. **Call the incident lead.** If they cannot be reached, call the next person on the contact list.',
    '3. **Start a paper log** on the sheets at the back: time, what happened, what was decided, who did it.',
    '4. **Answer the questions** below, then work the checklist for the scenario.',
    '5. **Check who must be told** in section 3 and note each deadline against the discovery time.',
  ].join('\n'));
  pdf.keyValues([
    { label: 'Discovered (date and time)', value: BLANK },
    { label: 'Reported by', value: BLANK },
    { label: 'Incident lead told at', value: BLANK },
  ]);
  pdf.heading('Questions that decide who must be told', 2);
  pdf.paragraph('If unsure, answer yes.', { muted: true });
  pdf.table(
    [{ header: 'Question', weight: 80 }, { header: 'Yes', weight: 10 }, { header: 'No', weight: 10 }],
    kit.questions.map((q) => [q.hint ? `${q.question}\n${q.hint}` : String(q.question), BOX, BOX]),
  );

  page('Incident roles and contacts', 2);
  // The organization's own numbers (Administration > Organization), for whoever picks up the kit.
  const o = kit.organization;
  const own = o ? [
    { label: 'Organization', value: o.name },
    { label: 'Address', value: o.address },
    { label: 'Main phone', value: o.phone },
    { label: 'Security contact phone', value: o.security_phone },
    { label: 'Security contact email', value: o.security_email },
  ].filter((r) => r.value) : [];
  if (own.length > 1) pdf.keyValues(own);
  if (!kit.contacts.length) pdf.note('No contacts are set up. Add them under Notification rules and checklists, then reprint.');
  else {
    pdf.table(
      [{ header: 'Role', weight: 22 }, { header: 'Person', weight: 22 }, { header: 'Contact', weight: 22 }, { header: 'What the role does', weight: 34 }],
      kit.contacts.map((c) => [String(c.role ?? ''), c.person_name || BLANK.slice(0, 14), c.contact || BLANK.slice(0, 14), String(c.notes ?? '')]),
      { boldFirstColumn: true },
    );
  }
  pdf.paragraph('Give phone numbers that work when email is down. Fill any blank by hand and correct the standing contact list afterwards.', { muted: true });

  page('Who must be told, and by when', 3);
  if (!kit.rules.length) pdf.note('No notification rules are set up.');
  else {
    if (!active.length) pdf.note('No rule has a deadline yet. Until an administrator sets the deadlines, take advice on who must be told and how quickly.');
    pdf.table(
      [{ header: 'Notify', weight: 22 }, { header: 'When', weight: 20 }, { header: 'Deadline from discovery', weight: 16 }, { header: 'Guidance', weight: 42 }],
      [...active, ...other].map((r) => [
        `${r.party}\n${r.required ? 'Required' : 'Recommended'}`, String(r.trigger_label ?? ''), deadlineText(r.deadline_hours), String(r.guidance ?? ''),
      ]),
      { boldFirstColumn: true },
    );
  }

  page('Severity guide and ransom rule', 4);
  if (!kit.severities.length) pdf.note('No severities are set up.');
  else {
    pdf.table([{ header: 'Severity', weight: 22 }, { header: 'Use when', weight: 78 }],
      kit.severities.map((s) => [String(s.label ?? s.value), String(s.meta?.guide ?? '')]), { boldFirstColumn: true });
  }
  pdf.heading('Ransom', 2);
  pdf.paragraph(kit.ransom_approval.on
    ? `Do not negotiate or pay without formal approval. A payment cannot be recorded as approved without the ${/^[A-Z][a-z]/.test(kit.ransom_approval.name) ? kit.ransom_approval.name.charAt(0).toLowerCase() + kit.ransom_approval.name.slice(1) : kit.ransom_approval.name}.`
    : 'Do not negotiate or pay without the formal approval your policy requires, and record that approval.');

  let n = 5;
  if (!kit.checklists.length) {
    page('Scenario checklists', n++);
    pdf.note('No checklist templates are set up.');
  }
  for (const c of kit.checklists) {
    page(`Checklist: ${c.label}`, n++);
    for (const [name, steps] of [['Containment: stop it getting worse', c.containment], ['Recovery: get back to normal', c.recovery]] as const) {
      if (!steps.length) continue;
      pdf.heading(name, 2);
      pdf.table([{ header: 'Done', weight: 9 }, { header: 'Step', weight: 73 }, { header: 'Time', weight: 18 }], steps.map((s) => [BOX, s, '']));
    }
  }

  page('Notification record sheet', n++);
  pdf.paragraph('Record every notification as it is made: the deadline you worked out, who took the report, how, when, and any reference they gave.', { muted: true });
  const tall = ' \n ';
  pdf.table(
    [{ header: 'Party', weight: 22 }, { header: 'Deadline', weight: 16 }, { header: 'Who was notified, and how', weight: 30 }, { header: 'When', weight: 16 }, { header: 'Reference', weight: 16 }],
    [...active.map((r) => String(r.party)), ...Array.from({ length: Math.max(4, 10 - active.length) }, () => tall)].map((p) => [p, tall, tall, tall, tall]),
    { boldFirstColumn: true },
  );

  for (const sheet of [1, 2]) {
    page(`Incident log sheet ${sheet}`, n);
    pdf.paragraph('One line per event or decision. Copy the entries into the system when it is available; keep this sheet as evidence.', { muted: true });
    pdf.paragraph(`Incident: ${BLANK}   Kept by: ${BLANK.slice(0, 16)}   Date: ${BLANK.slice(0, 12)}`);
    pdf.table([{ header: 'Time', weight: 13 }, { header: 'What happened, what was decided or done', weight: 67 }, { header: 'Who', weight: 20 }],
      Array.from({ length: 18 }, () => [tall, tall, tall]));
  }
  return { pdf: await pdf.finish(), made };
}

// ---------- stored copies ----------

export interface KitCopy {
  id: string; created_at: string; reason: KitReason; reason_label: string; produced_by_name: string | null;
  fingerprint: string; pages: number; size_bytes: number; delivery: string | null;
}

interface Guards {
  view: { preHandler: (req: FastifyRequest) => Promise<void> };
  exporter: { preHandler: (req: FastifyRequest) => Promise<void> };
  administer: { preHandler: (req: FastifyRequest) => Promise<void> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COPY_COLS = 'id, created_at, reason, produced_by_name, fingerprint, pages, size_bytes, delivery';
const shape = (r: Row): KitCopy => ({
  id: r.id, created_at: new Date(r.created_at).toISOString(), reason: r.reason, reason_label: REASONS[r.reason as KitReason] ?? r.reason,
  produced_by_name: r.produced_by_name ?? null, fingerprint: r.fingerprint, pages: Number(r.pages), size_bytes: Number(r.size_bytes), delivery: r.delivery ?? null,
});

export function makeKitCopies(ctx: ModuleContext) {
  const { db } = ctx;
  const everyDays = async () => {
    const v = Number(await ctx.settings.get(KIT_SETTINGS.everyDays, DEFAULT_KIT_EVERY_DAYS));
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_KIT_EVERY_DAYS;
  };
  const keep = async () => {
    const v = Number(await ctx.settings.get(KIT_SETTINGS.keep, DEFAULT_KIT_KEEP));
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_KIT_KEEP;
  };
  const recipientIds = async (): Promise<string[]> => {
    const v = await ctx.settings.get<unknown>(KIT_SETTINGS.recipients, []);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  };

  /** Active people with the permissions their enabled roles grant (as core loads a session user). */
  async function people(ids: string[] | null): Promise<SessionUser[]> {
    const rows = await db.query<Row>(
      `select u.id, u.username, u.display_name, u.email,
          coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
          coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
       from users u
       left join user_roles ur on ur.user_id = u.id
       left join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
       where u.status = 'active' and u.deleted_at is null and ($1::uuid[] is null or u.id = any($1::uuid[]))
       group by u.id order by u.display_name`, [ids]);
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }) as SessionUser);
  }
  /** Who may receive the kit: it is restricted, and a file taken out of the application is an export. */
  const mayReceive = (u: SessionUser) => ctx.can(u, 'security.view') && ctx.can(u, 'security.export');

  async function latest(): Promise<Row | undefined> {
    return db.one<Row>(`select ${COPY_COLS} from incident_kit_copies order by created_at desc, id desc limit 1`);
  }

  /** Emails a copy to the named recipients who may still receive it. Returns what happened, for the screen. */
  async function email(copyId: string, pdf: Buffer, made: string): Promise<string | null> {
    const ids = await recipientIds();
    if (!ids.length) return null;
    const send = ctx.app.hasDecorator('sendMail') ? ctx.app.sendMail : undefined;
    if (typeof send !== 'function') return 'Not emailed: email is not available in this installation.';
    const found = await people(ids);
    const allowed = found.filter(mayReceive);
    const skipped = ids.length - allowed.length;
    const skipText = skipped ? ` ${skipped} named ${skipped === 1 ? 'person was' : 'people were'} skipped (no longer active, or without security.view and security.export).` : '';
    if (!allowed.length) return `Not emailed.${skipText}`;
    try {
      const res = await send.call(ctx.app, {
        userIds: allowed.map((u) => u.id), template: 'message', purpose: 'security',
        data: {
          subject: `Security incident kit, produced ${made}`,
          message: 'A new copy of the offline security incident kit is attached. Print it, replace your older paper copies and destroy them.\n\n'
            + 'It is a restricted security record: keep it safe and do not forward it.',
          link: '/security-incidents/kit',
        },
        attachments: [{ filename: `security-incident-kit-${dayInZone(0, new Date())}.pdf`, content: pdf, contentType: PDF_TYPE }],
      });
      if (!res || res.enabled === false) return `Not emailed: email is switched off.${skipText}`;
      return `Emailed to ${res.queued} ${res.queued === 1 ? 'person' : 'people'}.${skipText}`;
    } catch (err) {
      console.error('[secincidents] kit email failed:', err);
      return `The email could not be queued; the copy is stored (${copyId.slice(0, 8)}).${skipText}`;
    }
  }

  /** Renders, stores and (for automatic copies) emails a copy; old copies beyond the number kept are removed. */
  async function produce(reason: KitReason, by: SessionUser | null, req: FastifyRequest | null): Promise<KitCopy> {
    const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
    const kit = await loadKit(ctx, by?.displayName ?? 'Scheduled job');
    const fingerprint = kitFingerprint(kit);
    const { pdf, made } = await renderKitPdf(kit, appName, await printBranding(db));
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
    const row = (await db.one<Row>(
      `insert into incident_kit_copies (created_at, reason, produced_by, produced_by_name, fingerprint, pages, size_bytes, content)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COPY_COLS}`,
      [kit.generated_at, reason, by?.id ?? null, by?.displayName ?? null, fingerprint, pages, pdf.length, pdf.toString('base64')],
    ))!;
    if (reason !== 'on_demand') {
      const delivery = await email(row.id, pdf, made);
      if (delivery) {
        await db.query('update incident_kit_copies set delivery = $2 where id = $1', [row.id, delivery]);
        row.delivery = delivery;
      }
    }
    const max = await keep();
    await db.query(
      `delete from incident_kit_copies where id in (select id from incident_kit_copies order by created_at desc, id desc offset $1)`, [max]);
    await ctx.audit(req, {
      action: 'security_incident.kit_pdf', summary: `Offline incident kit PDF made (${REASONS[reason].toLowerCase()})${row.delivery ? `. ${row.delivery}` : ''}`,
      after: { copy_id: row.id, reason, pages, fingerprint },
    });
    return shape(row);
  }

  /**
   * The scheduled check: a first copy, a new copy when the contents changed since the last one,
   * and otherwise a fresh copy once the last is `every_days` old (0: only after changes).
   */
  async function check(now = new Date()): Promise<{ made: KitReason | null }> {
    const last = await latest();
    const days = await everyDays();
    if (!last) return { made: (await produce('first', null, null)).reason };
    const fingerprint = kitFingerprint(await loadKit(ctx, ''));
    if (fingerprint !== last.fingerprint) return { made: (await produce('change', null, null)).reason };
    if (days > 0 && now.getTime() - new Date(last.created_at).getTime() >= days * DAY) return { made: (await produce('schedule', null, null)).reason };
    return { made: null };
  }

  /** The copies, the state of the latest one and, for administrators, the settings. */
  async function state(user: SessionUser) {
    const copies = (await db.query<Row>(`select ${COPY_COLS} from incident_kit_copies order by created_at desc, id desc`)).map(shape);
    const current = kitFingerprint(await loadKit(ctx, ''));
    // The current contents were first printed by the oldest copy in the unbroken run of copies with this fingerprint.
    let since: string | null = null;
    for (const c of copies) { if (c.fingerprint !== current) break; since = c.created_at; }
    const admin = ctx.can(user, 'security.administer');
    const ids = await recipientIds();
    const everyone = admin ? await people(null) : [];
    const eligible = everyone.filter(mayReceive);
    return {
      copies: copies.map(({ fingerprint, ...c }) => ({ ...c, current: fingerprint === current })),
      latest_is_current: copies.length > 0 && copies[0].fingerprint === current,
      current_since: since,
      check_minutes: KIT_CHECK_MS / MINUTE,
      every_days: await everyDays(),
      keep: await keep(),
      mail_on: ctx.app.hasDecorator('mailEnabled') ? Boolean(await ctx.app.mailEnabled()) : false,
      can_export: ctx.can(user, 'security.export'),
      can_administer: admin,
      ...(admin ? {
        recipients: ids.map((id) => {
          const p = everyone.find((u) => u.id === id);
          return { id, label: p?.displayName ?? 'Inactive or removed user', eligible: Boolean(p && mayReceive(p)) };
        }),
        eligible: eligible.map((u) => ({ id: u.id, label: u.displayName })),
      } : {}),
    };
  }

  return { produce, check, state, latest, recipientIds, everyDays, keep, mayReceive, people };
}

export function registerKit(ctx: ModuleContext, g: Guards) {
  const { app, db } = ctx;
  const copies = makeKitCopies(ctx);

  app.get('/api/security-incidents/kit', g.view, async (req) => {
    const kit = await loadKit(ctx, req.user!.displayName);
    await ctx.audit(req, { action: 'security_incident.kit_export', summary: 'Offline incident kit opened' });
    return kit;
  });

  app.get('/api/security-incidents/kit/copies', g.view, async (req) => copies.state(req.user!));
  ctx.describeRoute({
    method: 'GET', path: '/api/security-incidents/kit/copies', tag: 'Security incidents', permission: 'security.view',
    summary: 'Stored PDF copies of the offline incident kit, whether the latest is up to date, and the schedule',
    description: 'Needs `security.view` (restricted). `recipients` and `eligible` are returned to `security.administer` only.',
    response: `{ copies: [{ id: uuid, created_at: datetime, reason: 'first' | 'schedule' | 'change' | 'on_demand', reason_label: string, produced_by_name: string | null,
      pages: number, size_bytes: number, delivery: string | null, current: boolean }], latest_is_current: boolean, current_since: datetime | null,
      check_minutes: number, every_days: number, keep: number, mail_on: boolean, can_export: boolean, can_administer: boolean,
      recipients?: [{ id: uuid, label: string, eligible: boolean }], eligible?: [{ id: uuid, label: string }] }`,
  });

  app.post('/api/security-incidents/kit/copies', g.exporter, async (req, reply) => {
    const made = await copies.produce('on_demand', req.user!, req);
    reply.code(201);
    return made;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/security-incidents/kit/copies', tag: 'Security incidents', permission: 'security.export',
    summary: 'Make a PDF copy of the offline incident kit now', description: 'Needs `security.view` and `security.export`. Copies made on request are not emailed. Audited.',
    response: '{ id, created_at, reason, reason_label, produced_by_name, fingerprint, pages, size_bytes, delivery }',
  });

  app.get('/api/security-incidents/kit/copies/:copyId/pdf', g.exporter, async (req, reply) => {
    const id = String((req.params as Row).copyId ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>('select id, created_at, content from incident_kit_copies where id = $1', [id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'That copy of the kit no longer exists.');
    await ctx.audit(req, { action: 'security_incident.kit_download', summary: 'Offline incident kit PDF downloaded', after: { copy_id: row!.id } });
    const day = new Date(row!.created_at).toISOString().slice(0, 10);
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="security-incident-kit-${day}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(Buffer.from(String(row!.content), 'base64'));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/security-incidents/kit/copies/:copyId/pdf', tag: 'Security incidents', permission: 'security.export',
    summary: 'Download one stored PDF copy of the offline incident kit', description: 'Needs `security.view` and `security.export`. Audited.', response: 'application/pdf',
  });

  /** Body: { every_days?: 0..90, keep?: 1..100, recipients?: uuid[] }. Changing who receives it by email needs a recent password confirmation. */
  app.patch('/api/security-incidents/kit/settings', g.administer, async (req) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(Number(v)) && v !== '' && v !== null && Number(v) >= lo && Number(v) <= hi;
    if (b.every_days !== undefined && !intIn(b.every_days, 0, 90)) fields.every_days = 'Enter a whole number of days from 0 to 90.';
    if (b.keep !== undefined && !intIn(b.keep, 1, 100)) fields.keep = 'Keep between 1 and 100 copies.';
    let recipients: string[] | undefined;
    if (b.recipients !== undefined) {
      if (!Array.isArray(b.recipients) || b.recipients.some((x: unknown) => typeof x !== 'string' || !UUID_RE.test(x))) fields.recipients = 'Choose people from the list.';
      else {
        recipients = [...new Set(b.recipients as string[])].slice(0, 50);
        const found = await copies.people(recipients);
        const bad = recipients.filter((id) => !found.some((u) => u.id === id && copies.mayReceive(u)));
        if (bad.length) fields.recipients = 'Only active people with security.view and security.export can receive the kit.';
      }
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const before = { every_days: await copies.everyDays(), keep: await copies.keep(), recipients: await copies.recipientIds() };
    const changesRecipients = recipients !== undefined && [...recipients].sort().join() !== [...before.recipients].sort().join();
    // Sending a restricted record out of the application by email: confirm who is asking first.
    if (changesRecipients && recipients!.length) await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'change who receives the incident kit by email');
    if (b.every_days !== undefined) await ctx.settings.set(KIT_SETTINGS.everyDays, Number(b.every_days), req);
    if (b.keep !== undefined) await ctx.settings.set(KIT_SETTINGS.keep, Number(b.keep), req);
    if (changesRecipients) await ctx.settings.set(KIT_SETTINGS.recipients, recipients, req);
    const after = { every_days: await copies.everyDays(), keep: await copies.keep(), recipients: await copies.recipientIds() };
    await ctx.audit(req, { action: 'security_incident.kit_settings', summary: 'Offline incident kit schedule changed', before, after });
    return copies.state(req.user!);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/security-incidents/kit/settings', tag: 'Security incidents', permission: 'security.administer',
    summary: 'How often the offline incident kit PDF is made, how many copies are kept, and who receives it by email',
    description: 'Needs `security.view` and `security.administer`. Recipients must be active and hold `security.view` and `security.export`; changing them needs a recent password confirmation (403 `reauth_required`). Audited.',
    body: '{ every_days?: integer 0-90 (0: only after changes), keep?: integer 1-100, recipients?: [uuid] }',
  });

  return copies;
}

/** The recurring check on the job queue (skipped while the security incidents area is switched off). */
export async function scheduleKit(ctx: ModuleContext, copies: ReturnType<typeof makeKitCopies>) {
  await scheduleWork(ctx, 'secincidents.kit_pdf', () => copies.check(), { every: KIT_CHECK_MS, firstRunInMs: 5 * MINUTE, maxAttempts: 2 });
}
