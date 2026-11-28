// Reminder settings on one administration page (Administration > Reminders): how far ahead
// each module's reminders go out, and the notification module's own thresholds.
//
// The settings belong to the modules that read them; this is only the screen. Each module
// reads its key with `ctx.settings.get(key, fallback)` using the same fallback as `default`
// here. A setting appears only when the record type it is about is loaded (`requires`).
// Changes go through `ctx.settings.set(key, value, req)`, which writes the audit event.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

export type ReminderSettingKind = 'number' | 'steps' | 'statuses';

export interface ReminderSettingDef {
  key: string;
  group: string;
  label: string;
  description: string;
  kind: ReminderSettingKind;
  /** For numbers and steps: the unit shown beside the box. */
  unit?: 'days' | 'months' | 'hours' | 'hour of the day';
  min?: number;
  max?: number;
  default: number | number[] | string[];
  /** For statuses: the lookup list the values come from. */
  list?: string;
  /** The record type this setting is about; left out when that module is not loaded. */
  requires?: string;
}

export const KEEP_READ_SETTING = 'notifications.keep_read_days';
export const DEFAULT_KEEP_READ_DAYS = 90;

export const REMINDER_SETTINGS: ReminderSettingDef[] = [
  {
    key: 'notifications.action_due_days', group: 'Actions', requires: 'action', kind: 'number', unit: 'days', min: 0, max: 60, default: 3,
    label: 'Remind action owners before the due date',
    description: 'An action’s owner is reminded once a day from this many days before its due date until it is closed.',
  },
  {
    key: 'notifications.action_closed_statuses', group: 'Actions', requires: 'action', kind: 'statuses', list: 'action_status', default: ['done', 'cancelled'],
    label: 'Action statuses that need no reminder',
    description: 'Actions in these statuses are finished: their owners are not reminded.',
  },
  {
    key: 'notifications.ticket_breach_hours', group: 'Service desk', requires: 'ticket', kind: 'number', unit: 'hours', min: 1, max: 72, default: 4,
    label: 'Warn ticket assignees before the resolution target',
    description: 'The assignee is told once a day when a ticket’s resolution target is this close.',
  },
  {
    key: 'notifications.digest_hour', group: 'Notifications', kind: 'number', unit: 'hour of the day', min: 0, max: 23, default: 7,
    label: 'Daily email summary goes out from',
    description: 'For people who chose one email a day: the hour (organization time zone, 0 to 23) the summary is sent.',
  },
  {
    key: KEEP_READ_SETTING, group: 'Notifications', kind: 'number', unit: 'days', min: 7, max: 730, default: DEFAULT_KEEP_READ_DAYS,
    label: 'Remove read notifications after',
    description: 'Notifications that have been read are removed from everyone’s list this many days after they were sent. Unread ones are kept.',
  },
  {
    key: 'inventory.reminder_days', group: 'Inventory', requires: 'asset', kind: 'steps', unit: 'days', min: 0, max: 365, default: [30, 7, 0],
    label: 'Warranty and support end reminders',
    description: 'Days before a warranty or support end date that the asset’s owner is reminded; 0 is the day itself. Each step goes out once.',
  },
  {
    key: 'obligations.reminder_days', group: 'Obligations', requires: 'obligation', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind obligation owners before the next due date',
    description: 'The owner is told once when the next due date comes within this many days, and once more when it is reached.',
  },
  {
    key: 'frameworks.review_reminder_days', group: 'Framework outcomes', requires: 'framework_outcome', kind: 'number', unit: 'days', min: 0, max: 90, default: 14,
    label: 'Remind outcome owners before the review date',
    description: 'The owner is told once when the review date comes within this many days, and once when it is reached.',
  },
  {
    key: 'frameworks.evidence_reminder_days', group: 'Framework outcomes', requires: 'framework_outcome', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind outcome owners before an evidence note expires',
    description: 'The owner is told once when an evidence note’s expiry date comes within this many days, and once when it has expired.',
  },
  {
    key: 'risks.acceptance_reminder_days', group: 'Risks', requires: 'risk', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind risk owners before an acceptance expires',
    description: 'The risk’s owner is told once when its acceptance expires within this many days.',
  },
  {
    key: 'safety.hazard_review_reminder_days', group: 'Safety', requires: 'hazard', kind: 'number', unit: 'days', min: 0, max: 365, default: 14,
    label: 'Remind hazard owners before the review date',
    description: 'The owner is told once when a hazard’s review date comes within this many days, and once when it is reached.',
  },
  {
    key: 'actions.verification_reminder_days', group: 'Actions', requires: 'action', kind: 'number', unit: 'days', min: 0, max: 365, default: 7,
    label: 'Remind verifiers before the verification date',
    description: 'The verifier is told once when an action\'s verification date comes within this many days, and once more when it is reached.',
  },
  {
    key: 'audits.inspection_reminder_days', group: 'Audits and inspections', requires: 'inspection', kind: 'number', unit: 'days', min: 0, max: 60, default: 2,
    label: 'Remind inspectors before an inspection is due',
    description: 'The inspector is told once when an inspection comes within this many days (it is created from its schedule then), and once when it is overdue.',
  },
  {
    key: 'audits.request_reminder_days', group: 'Audits and inspections', requires: 'audit_request', kind: 'number', unit: 'days', min: 0, max: 60, default: 3,
    label: 'Remind people asked for audit evidence',
    description: 'The person asked is told once when an evidence request comes within this many days of its due date, and once when it is overdue.',
  },
  {
    key: 'controls.test_reminder_days', group: 'Controls', requires: 'control', kind: 'number', unit: 'days', min: 0, max: 365, default: 14,
    label: 'Remind control owners before a test is due',
    description: 'A control’s owner is told once when its next test comes within this many days, and once when it is due or overdue.',
  },
  {
    key: 'governance.pack_days', group: 'Committees and meetings', requires: 'meeting', kind: 'number', unit: 'days', min: 0, max: 60, default: 5,
    label: 'Remind secretaries before a meeting\'s pack is due',
    description: 'A committee\'s secretary is told once when a meeting is this many days away and no report pack has been frozen for it.',
  },
  {
    key: 'policies.plan_review_reminder_days', group: 'Policies', requires: 'policy', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind plan owners before the annual review',
    description: 'The owner of a plan is told once when its review date is this close, and once when it is reached, unless a review is already running.',
  },
  {
    key: 'training.certification_reminder_days', group: 'Training', requires: 'certification', kind: 'steps', unit: 'days', min: 1, max: 365, default: [90, 60, 30],
    label: 'Certification expiry reminders',
    description: 'Days before a certification expires that the person and their supervisor are reminded; each step goes out once, and once more when it has expired.',
  },
  {
    key: 'condition.assessment_reminder_days', group: 'Asset condition', requires: 'condition_assessment', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind before a condition assessment is due',
    description: 'The owner of an asset class (or everyone who may edit assets) gets one reminder per class listing how many of the items in it are due for their next condition assessment within this many days or overdue.',
  },
  {
    key: 'condition.assessment_every_months', group: 'Asset condition', requires: 'condition_assessment', kind: 'number', unit: 'months', min: 1, max: 240, default: 24,
    label: 'Time between condition assessments',
    description: 'How often an item with an asset class is assessed when its class does not set its own interval.',
  },
  {
    key: 'continuity.plan_review_reminder_days', group: 'Business continuity', requires: 'continuity_plan', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind plan owners before a plan review is due',
    description: 'A continuity plan’s owner is told once when its review date is this close, and once more when the date has passed.',
  },
  {
    key: 'continuity.bia_reminder_days', group: 'Business continuity', requires: 'business_process', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind process owners before an impact analysis is due',
    description: 'A business process’s owner is told once when its next business impact analysis is this close.',
  },
  {
    key: 'privacy.review_reminder_days', group: 'Privacy', requires: 'privacy_assessment', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind assessment owners before a privacy review',
    description: 'The owner of an approved privacy impact assessment is told once when its next review comes within this many days.',
  },
  {
    key: 'vendors.reassessment_reminder_days', group: 'Vendors and contracts', requires: 'vendor', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind vendor owners before a reassessment or exclusion-list check is due',
    description: 'A vendor’s owner is reminded once for each due date, this many days before it.',
  },
  {
    key: 'funding.subrecipient_reminder_days', group: 'Funding', requires: 'subrecipient', kind: 'number', unit: 'days', min: 0, max: 365, default: 30,
    label: 'Remind before sub-recipient monitoring is due',
    description: 'The person who monitors a sub-recipient is reminded once for each due date, this many days before it.',
  },
  {
    key: 'evidence.reminder_days', group: 'Evidence library', requires: 'evidence_record', kind: 'steps', unit: 'days', min: 0, max: 365, default: [30, 7, 0],
    label: 'Remind evidence owners before evidence lapses',
    description: 'An evidence record’s owner is reminded this many days before its “valid until” date (and on the day), once for each step.',
  },
  {
    key: 'audits.verification_days', group: 'Audits', requires: 'audit_finding', kind: 'number', unit: 'days', min: 1, max: 365, default: 30,
    label: 'Days the auditor has to verify a finding',
    description: 'Once a finding is ready for verification, its verification is due this many days later; the auditor is reminded when it is overdue.',
  },
  // Wave 26 (E46): insurance, civil rights and strategy. Each is also changed on its area's Settings page.
  {
    key: 'insurance.renewal_reminder_days', group: 'Insurance', requires: 'insurance_policy', kind: 'steps', unit: 'days', min: 0, max: 365, default: [90, 60, 30],
    label: 'Remind policy owners before a policy expires',
    description: 'A policy’s owner is reminded this many days before the policy expires, once for each step.',
  },
  {
    key: 'insurance.application_reminder_days', group: 'Insurance', requires: 'insurance_policy', kind: 'steps', unit: 'days', min: 0, max: 180, default: [14, 3, 0],
    label: 'Remind policy owners before the renewal application is due',
    description: 'A policy’s owner is reminded this many days before its renewal application is due, once for each step.',
  },
  {
    key: 'insurance.certificate_reminder_days', group: 'Insurance', requires: 'insurance_certificate', kind: 'steps', unit: 'days', min: 0, max: 180, default: [30, 0],
    label: 'Remind certificate owners before a certificate of insurance expires',
    description: 'A certificate’s owner is reminded this many days before it expires, once for each step.',
  },
  {
    key: 'civilrights.reminder_days', group: 'Civil rights', requires: 'civil_rights_complaint', kind: 'number', unit: 'days', min: 0, max: 90, default: 7,
    label: 'Remind before a complaint or report time limit',
    description: 'The investigator (or the complaint handlers) and report owners are reminded this many days before a time limit, and once when it has passed.',
  },
  {
    key: 'strategy.submission_reminder_days', group: 'Strategy', requires: 'stat_submission', kind: 'steps', unit: 'days', min: 0, max: 365, default: [30, 7, 0],
    label: 'Remind the preparer before a statistical report is due',
    description: 'The person preparing a statistical report is reminded at each step until it is submitted.',
  },
  {
    key: 'attachments.link_check_days', group: 'Files', kind: 'number', unit: 'days', min: 1, max: 3650, default: 90,
    label: 'Remind record owners to check linked documents',
    description: 'A link to a document kept elsewhere is due for a check this many days after it was last checked; the record’s owner is told once when it becomes due.',
  },
];

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** The stored value if it is valid, else the default (what the module reading it also does). */
function effective(def: ReminderSettingDef, stored: unknown, listValues: string[]): number | number[] | string[] {
  const err = validate(def, stored, listValues);
  return err === null ? normalize(def, stored) : def.default;
}

function normalize(def: ReminderSettingDef, value: unknown): number | number[] | string[] {
  if (def.kind === 'steps') return [...new Set(value as number[])].sort((a, b) => b - a);
  if (def.kind === 'statuses') return [...new Set(value as string[])];
  return value as number;
}

/** An error message, or null when the value is acceptable. */
export function validate(def: ReminderSettingDef, value: unknown, listValues: string[]): string | null {
  const range = `from ${def.min} to ${def.max}`;
  if (def.kind === 'number') {
    return isInt(value) && value >= def.min! && value <= def.max! ? null : `Enter a whole number ${range}.`;
  }
  if (def.kind === 'steps') {
    if (!Array.isArray(value) || !value.length) return 'Enter at least one number of days.';
    if (value.length > 6) return 'Enter at most six steps.';
    return value.every((n) => isInt(n) && n >= def.min! && n <= def.max!) ? null : `Each step is a whole number of days ${range}.`;
  }
  if (!Array.isArray(value)) return 'Choose the statuses as a list.';
  const unknown = value.filter((v) => typeof v !== 'string' || !listValues.includes(v));
  return unknown.length ? `Unknown status: ${unknown.map(String).join(', ')}.` : null;
}

export function registerReminderSettings(ctx: ModuleContext) {
  const { app } = ctx;
  const admin = { preHandler: ctx.requirePerm('admin.administer') };

  const available = () => REMINDER_SETTINGS.filter((d) => !d.requires || ctx.resources.get(d.requires));
  const listValues = async (def: ReminderSettingDef) =>
    def.list ? (await ctx.lookups.values(def.list)).map((v) => v.value) : [];

  async function overview() {
    const groups: { label: string; settings: Row[] }[] = [];
    for (const def of available()) {
      const values = def.list ? await ctx.lookups.values(def.list) : [];
      const stored = await ctx.settings.get<unknown>(def.key, def.default);
      let group = groups.find((g) => g.label === def.group);
      if (!group) groups.push(group = { label: def.group, settings: [] });
      group.settings.push({
        key: def.key, label: def.label, description: def.description, kind: def.kind, unit: def.unit ?? null,
        min: def.min ?? null, max: def.max ?? null, default: def.default,
        value: effective(def, stored, values.map((v) => v.value)),
        options: def.list ? values.map((v) => ({ value: v.value, label: v.label })) : undefined,
      });
    }
    return { groups };
  }

  app.get('/api/notifications/reminder-settings', admin, async () => overview());
  ctx.describeRoute({
    method: 'GET', path: '/api/notifications/reminder-settings', tag: 'Notifications', permission: 'admin.administer',
    summary: 'Reminder settings of every loaded module, grouped, with their current values and defaults',
    response: '{ groups: [{ label, settings: [{ key, label, description, kind, unit, min, max, default, value, options? }] }] }',
  });

  app.patch('/api/notifications/reminder-settings', admin, async (req: FastifyRequest) => {
    const values = ((req.body ?? {}) as Row).values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) ctx.fail(400, 'validation', 'Send the settings as { values: { key: value } }.');
    const defs = new Map(available().map((d) => [d.key, d]));
    const fields: Record<string, string> = {};
    const changes: [ReminderSettingDef, unknown][] = [];
    for (const [key, value] of Object.entries(values as Row)) {
      const def = defs.get(key);
      if (!def) { fields[key] = 'This is not a reminder setting.'; continue; }
      const err = validate(def, value, await listValues(def));
      if (err) fields[key] = err;
      else changes.push([def, normalize(def, value)]);
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    for (const [def, value] of changes) {
      const before = effective(def, await ctx.settings.get<unknown>(def.key, def.default), await listValues(def));
      if (JSON.stringify(before) !== JSON.stringify(value)) await ctx.settings.set(def.key, value, req); // audited by the settings service
    }
    return overview();
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/notifications/reminder-settings', tag: 'Notifications', permission: 'admin.administer',
    summary: 'Change reminder settings; each change is audited',
    body: '{ values: { "<key>": number | number[] | string[] } }',
  });
}
