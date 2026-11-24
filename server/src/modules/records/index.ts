// Records requests and privacy (E34-03 to E34-08): requests for records and for personal data with a
// due clock, responsive records with exemptions, and privacy impact assessments on systems that hold
// personal data. Permission modules `records` and `privacy`; feature area `records`. Legal holds are
// a separate, always-on module (`holds`).
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { registerPrivacy } from './privacy.ts';
import { registerRequests } from './requests.ts';
import { seedRecords } from './seed.ts';
import { cleanDueDays, readSettings, SETTINGS, shownSettings } from './settings.ts';

const MINUTES_15 = 15 * 60_000;
const DAY = 24 * 3_600_000;

async function seedDefaults(ctx: ModuleContext) {
  const records = { module: 'records' };
  const privacy = { module: 'privacy' };
  // meta.personal: a request about someone's own personal data, seen only with privacy.view as well.
  await ctx.lookups.ensure('records_request_kind', [
    { value: 'records', label: 'Records request', color: 'blue', sort: 10 },
    { value: 'personal_access', label: 'Personal-data access', color: 'purple', sort: 20, meta: { personal: true } },
    { value: 'personal_correction', label: 'Personal-data correction', color: 'purple', sort: 30, meta: { personal: true } },
    { value: 'personal_deletion', label: 'Personal-data deletion', color: 'purple', sort: 40, meta: { personal: true } },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], records);
  await ctx.lookups.ensure('records_request_status', [
    { value: 'received', label: 'Received', color: 'blue', sort: 10 },
    { value: 'searching', label: 'Searching', color: 'teal', sort: 20 },
    { value: 'reviewing', label: 'Reviewing', color: 'amber', sort: 30 },
    { value: 'responded', label: 'Responded', color: 'green', sort: 40, meta: { final: true } },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 50, meta: { final: true } },
    { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 60, meta: { final: true } },
    { value: 'refused', label: 'Refused', color: 'red', sort: 70, meta: { final: true } },
  ], records);
  // Operator-defined: rename, add or retire values; none is any jurisdiction's legal ground.
  await ctx.lookups.ensure('records_exemption', [
    { value: 'personal_privacy', label: 'Personal privacy', sort: 10 },
    { value: 'security_sensitive', label: 'Security-sensitive', sort: 20 },
    { value: 'legal_advice', label: 'Legal advice', sort: 30 },
    { value: 'ongoing_investigation', label: 'Ongoing investigation', sort: 40 },
    { value: 'commercial_confidence', label: 'Commercial confidence', sort: 50 },
  ], records);
  await ctx.lookups.ensure('records_disclosure', [
    { value: 'full', label: 'Disclosed in full', color: 'green', sort: 10 },
    { value: 'partial', label: 'Disclosed in part', color: 'amber', sort: 20 },
    { value: 'withheld', label: 'Withheld', color: 'red', sort: 30 },
  ], records);
  await ctx.lookups.ensure('privacy_assessment_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'in_review', label: 'In review', color: 'blue', sort: 20 },
    { value: 'approved', label: 'Approved', color: 'green', sort: 30 },
    { value: 'needs_update', label: 'Needs update', color: 'amber', sort: 40 },
  ], privacy);
  await ctx.lookups.ensure('privacy_risk_level', [
    { value: 'low', label: 'Low', color: 'green', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'high', label: 'High', color: 'red', sort: 30 },
  ], privacy);
  // Configurable questions; meta.kind says how each is answered (yes_no or text).
  await ctx.lookups.ensure('privacy_question', [
    { value: 'new_technology', label: 'Does it use a new technology or a new use of existing data?', sort: 10, meta: { kind: 'yes_no' } },
    { value: 'large_scale', label: 'Does it process personal data about many people?', sort: 20, meta: { kind: 'yes_no' } },
    { value: 'monitoring', label: 'Does it observe or track people (for example video or location)?', sort: 30, meta: { kind: 'yes_no' } },
    { value: 'sensitive', label: 'Does it hold health, eligibility or other sensitive details?', sort: 40, meta: { kind: 'yes_no' } },
    { value: 'shared_outside', label: 'Who outside the organization receives the data?', sort: 50, meta: { kind: 'text' } },
  ], privacy);
}

/** The values this module adds to shared lists (contract C8), once every module has seeded its own lists. */
async function sharedValues(ctx: ModuleContext) {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [
      { value: 'records', label: 'Records request', sort: 175 },
      { value: 'privacy', label: 'Privacy assessment', sort: 176 },
    ]);
  }
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'records', label: 'Records requests and privacy', color: 'purple', sort: 79, meta: { description: 'A request is due soon or overdue, or a privacy assessment is due for review.' } },
    ]);
  }
}

async function register(ctx: ModuleContext) {
  await sharedValues(ctx);
  const requests = await registerRequests(ctx);
  const privacy = await registerPrivacy(ctx);

  // ---------------------------------------------------------------- settings
  ctx.app.get('/api/records/settings', { preHandler: ctx.requirePerm('records.view') }, async () => shownSettings(await readSettings(ctx)));
  ctx.describeRoute({
    method: 'GET', path: '/api/records/settings', tag: 'Records requests', permission: 'records.view',
    summary: 'Request deadlines (days by kind, "*" for every other kind; no jurisdiction\'s deadline is built in), working days, the amber point and the privacy review reminder',
    description: 'Working days are counted on the organization\'s working calendar: the service desk\'s business-hours calendar (its open weekdays and holidays), named in `workingCalendar` with its number of `holidays`; Monday to Friday when there is none.',
    response: '{ dueDays: { [kind | "*"]: days }, businessDays, amberFraction, reviewReminderDays, workingCalendar, holidays }',
  });
  ctx.app.put('/api/records/settings', { preHandler: ctx.requirePerm('records.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const before = await readSettings(ctx);
    const errors: Record<string, string> = {};
    const due = b.dueDays === undefined ? before.dueDays : cleanDueDays(b.dueDays);
    if (!due) errors.dueDays = 'Give whole days from 1 to 365 for each kind ("*" for every other kind).';
    const business = b.businessDays === undefined ? before.businessDays : b.businessDays;
    if (typeof business !== 'boolean') errors.businessDays = 'Use true or false.';
    const amber = b.amberFraction === undefined ? before.amberFraction : Number(b.amberFraction);
    if (!(amber > 0 && amber < 1)) errors.amberFraction = 'Give a fraction between 0 and 1, for example 0.25.';
    const remind = b.reviewReminderDays === undefined ? before.reviewReminderDays : Number(b.reviewReminderDays);
    if (!Number.isInteger(remind) || remind < 0 || remind > 365) errors.reviewReminderDays = 'Give whole days from 0 to 365.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    await ctx.settings.set(SETTINGS.dueDays, due, req);
    await ctx.settings.set(SETTINGS.businessDays, business, req);
    await ctx.settings.set(SETTINGS.amber, amber, req);
    await ctx.settings.set(SETTINGS.reviewReminderDays, remind, req);
    const after = shownSettings(await readSettings(ctx));
    await ctx.audit(req, { action: 'records.settings', summary: 'Records request and privacy settings changed', before: shownSettings(before), after });
    return after;
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/records/settings', tag: 'Records requests', permission: 'records.administer',
    summary: 'Change the request deadlines and clock settings (applies to requests received from now on; existing due dates stay)',
    body: '{ dueDays?, businessDays?, amberFraction?, reviewReminderDays? }',
  });

  // ---------------------------------------------------------------- jobs
  ctx.app.post('/api/records/reminders/run', { preHandler: ctx.requirePerm('records.administer') }, async () => ({
    clocks: await requests.runClocks(), reviews: await privacy.runReviewReminders(),
  }));
  ctx.describeRoute({
    method: 'POST', path: '/api/records/reminders/run', tag: 'Records requests', permission: 'records.administer',
    summary: 'Run the request clock alerts and the privacy review reminders now (each is sent once; they also run on their own)',
    response: '{ clocks: { amber, red }, reviews: { due, needsUpdate } }',
  });
  await scheduleWork(ctx, 'records.clocks', () => requests.runClocks(), { every: MINUTES_15, firstRunInMs: 130_000 });
  await scheduleWork(ctx, 'records.reminders', () => privacy.runReviewReminders(), { every: DAY, firstRunInMs: 170_000 });
}

const mod: ModuleDef = {
  key: 'records',
  seedDefaults,
  register,
  seed: seedRecords,
};
export default mod;
