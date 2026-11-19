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
  unit?: 'days' | 'hours' | 'hour of the day';
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
    key: 'notifications.action_due_days', group: 'Actions and tickets', requires: 'action', kind: 'number', unit: 'days', min: 0, max: 60, default: 3,
    label: 'Remind action owners before the due date',
    description: 'An action’s owner is reminded once a day from this many days before its due date until it is closed.',
  },
  {
    key: 'notifications.action_closed_statuses', group: 'Actions and tickets', requires: 'action', kind: 'statuses', list: 'action_status', default: ['done', 'cancelled'],
    label: 'Action statuses that need no reminder',
    description: 'Actions in these statuses are finished: their owners are not reminded.',
  },
  {
    key: 'notifications.ticket_breach_hours', group: 'Actions and tickets', requires: 'ticket', kind: 'number', unit: 'hours', min: 1, max: 72, default: 4,
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
