// Civil rights programs (wave 26, feature area `civilrights`, off by default): a transit organization's
// civil-rights and accessibility programs with their required elements, notices, language assistance
// and monitoring reports; complaints with their time limits, confidential by default; and business
// participation goals with awards, participating firms and attainment. Permission module
// `civilrights`. No jurisdiction's law, agency or program is built in: program types, elements, report
// types, bases and time limits are the organization's own lists, templates and settings.
// Eligibility for accessible services (individual medical data) is not part of it.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { registerComplaints } from './complaints.ts';
import { ensureLists, sharedValues } from './lists.ts';
import { registerParticipation } from './participation.ts';
import { registerPrograms } from './programs.ts';
import { seedCivilRights } from './seed.ts';
import { checkSettings, LIMITS, readSettings, SETTINGS, shownSettings } from './settings.ts';
import { registerSummary, runReminders } from './summary.ts';

const TAG = 'Civil rights';
const DAY = 24 * 3_600_000;

async function register(ctx: ModuleContext) {
  await sharedValues(ctx);
  await registerPrograms(ctx);
  await registerComplaints(ctx);
  await registerParticipation(ctx);
  registerSummary(ctx);

  ctx.app.get('/api/civil-rights/settings', { preHandler: ctx.requirePerm('civilrights.view') }, async () => shownSettings(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/civil-rights/settings', tag: TAG, permission: 'civilrights.view',
    summary: 'Complaint time limits in days (acknowledgment, investigation, appeal), whether each counts working days, and how many days ahead reminders are sent; no jurisdiction\'s deadline is built in',
    description: 'Working days are those of the organization\'s working calendar (the business-hours calendar records requests also count on: its open weekdays less its holidays), named in `workingCalendar` with its number of `holidays`; Monday to Friday when there is none.',
    response: '{ ackDays, investigationDays, appealDays, reminderDays, ackWorking, investigationWorking, appealWorking, workingCalendar, holidays }',
  });

  ctx.app.put('/api/civil-rights/settings', { preHandler: ctx.requirePerm('civilrights.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const before = await readSettings(ctx);
    const next = {
      ackDays: b.ackDays === undefined ? before.ackDays : Number(b.ackDays),
      investigationDays: b.investigationDays === undefined ? before.investigationDays : Number(b.investigationDays),
      appealDays: b.appealDays === undefined ? before.appealDays : Number(b.appealDays),
      reminderDays: b.reminderDays === undefined ? before.reminderDays : Number(b.reminderDays),
      ackWorking: b.ackWorking === undefined ? before.ackWorking : b.ackWorking,
      investigationWorking: b.investigationWorking === undefined ? before.investigationWorking : b.investigationWorking,
      appealWorking: b.appealWorking === undefined ? before.appealWorking : b.appealWorking,
    };
    const errors = checkSettings(next);
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    await ctx.settings.set(SETTINGS.ackDays, next.ackDays, req);
    await ctx.settings.set(SETTINGS.investigationDays, next.investigationDays, req);
    await ctx.settings.set(SETTINGS.appealDays, next.appealDays, req);
    await ctx.settings.set(SETTINGS.reminderDays, next.reminderDays, req);
    for (const l of LIMITS) if (next[l.working] !== before[l.working]) await ctx.settings.set(SETTINGS[l.working], next[l.working], req);
    await ctx.audit(req, { action: 'civilrights.settings', summary: 'Civil rights complaint time limits changed', before, after: next });
    return shownSettings(ctx);
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/civil-rights/settings', tag: TAG, permission: 'civilrights.administer',
    summary: 'Change the complaint time limits and whether each counts working or calendar days (they apply to complaints received from now on; dates already worked out stay)',
    body: '{ ackDays?, investigationDays?, appealDays?, reminderDays?, ackWorking?, investigationWorking?, appealWorking? }',
  });

  ctx.app.post('/api/civil-rights/reminders/run', { preHandler: ctx.requirePerm('civilrights.administer') }, async () => runReminders(ctx));
  ctx.describeRoute({
    method: 'POST', path: '/api/civil-rights/reminders/run', tag: TAG, permission: 'civilrights.administer',
    summary: 'Send the complaint, report and program update reminders now (each is sent once; they also run every day)',
    response: '{ complaints, reports, programs }',
  });
  await scheduleWork(ctx, 'civilrights.reminders', () => runReminders(ctx), { every: DAY, firstRunInMs: 190_000 });
}

const mod: ModuleDef = {
  key: 'civilrights',
  seedDefaults: ensureLists,
  register,
  seed: seedCivilRights,
};
export default mod;
