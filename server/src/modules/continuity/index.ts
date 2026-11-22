import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { registerActivations } from './activations.ts';
import { registerBia } from './bia.ts';
import { registerGaps } from './gaps.ts';
import { registerPlans } from './plans.ts';
import { registerProcesses } from './processes.ts';
import { registerContinuityReminders } from './reminders.ts';
import { seedContinuity } from './seed.ts';

/**
 * Business continuity and emergency management (E31): business processes and what they depend on,
 * impact analyses with tolerable downtime, continuity and emergency plans with call trees,
 * checklists, review and approval, the gap report (tolerable downtime against system recovery
 * time), and emergency activations for non-cyber events with a log, roles and checklists.
 * Permission module and feature area `continuity`. No mass notification or paging is sent: a call
 * tree is a list to print and call.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'continuity' };
  await ctx.lookups.ensure('process_criticality', [
    { value: 'vital', label: 'Vital', color: 'red', sort: 10, meta: { description: 'Must keep running or be restored within hours.' } },
    { value: 'essential', label: 'Essential', color: 'orange', sort: 20, meta: { description: 'Must be restored within a day or two.' } },
    { value: 'important', label: 'Important', color: 'amber', sort: 30, meta: { description: 'Can wait a few days.' } },
    { value: 'deferrable', label: 'Deferrable', color: 'gray', sort: 40, meta: { description: 'Can wait until things are back to normal.' } },
  ], own);
  await ctx.lookups.ensure('process_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'active', label: 'Active', color: 'green', sort: 20 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 30 },
  ], own);
  await ctx.lookups.ensure('bia_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'submitted', label: 'Submitted', color: 'blue', sort: 20 },
    { value: 'signed_off', label: 'Signed off', color: 'green', sort: 30 },
  ], own);
  // The organization's own questions; meta.kind is yes_no, number or text.
  await ctx.lookups.ensure('bia_question', [
    { value: 'riders_notice', label: 'Do riders notice within the first hour of an outage?', sort: 10, meta: { kind: 'yes_no' } },
    { value: 'deadline_reporting', label: 'Does an outage stop a report or payment that has a fixed deadline?', sort: 20, meta: { kind: 'yes_no' } },
    { value: 'workaround_hours', label: 'For how many hours can the manual workaround be kept up?', sort: 30, meta: { kind: 'number' } },
    { value: 'restore_needs', label: 'Who and what is needed to restore it (people, suppliers, equipment)?', sort: 40, meta: { kind: 'text' } },
  ], own);
  await ctx.lookups.ensure('continuity_plan_type', [
    { value: 'continuity', label: 'Business continuity plan', color: 'blue', sort: 10 },
    { value: 'emergency_operations', label: 'Emergency operations plan', color: 'red', sort: 20 },
    { value: 'it_disaster_recovery', label: 'IT disaster recovery plan', color: 'purple', sort: 30 },
    { value: 'severe_weather', label: 'Severe weather annex', color: 'teal', sort: 40 },
    { value: 'pandemic', label: 'Pandemic annex', color: 'amber', sort: 50 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  await ctx.lookups.ensure('continuity_plan_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'in_review', label: 'In review', color: 'blue', sort: 20 },
    { value: 'approved', label: 'Approved', color: 'green', sort: 30 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('continuity_phase', [
    { value: 'activate', label: 'Activate', color: 'red', sort: 10 },
    { value: 'respond', label: 'Respond', color: 'orange', sort: 20 },
    { value: 'recover', label: 'Recover', color: 'blue', sort: 30 },
    { value: 'stand_down', label: 'Stand down', color: 'green', sort: 40 },
  ], own);
  await ctx.lookups.ensure('emergency_event_type', [
    { value: 'severe_weather', label: 'Severe weather', color: 'teal', sort: 10 },
    { value: 'power_loss', label: 'Power loss', color: 'amber', sort: 20 },
    { value: 'service_disruption', label: 'Major service disruption', color: 'orange', sort: 30 },
    { value: 'facility_loss', label: 'Loss of a facility', color: 'red', sort: 40 },
    { value: 'public_health', label: 'Public health', color: 'purple', sort: 50 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  await ctx.lookups.ensure('activation_level', [
    { value: 'monitoring', label: 'Monitoring', color: 'blue', sort: 10 },
    { value: 'partial', label: 'Partial activation', color: 'amber', sort: 20 },
    { value: 'full', label: 'Full activation', color: 'red', sort: 30 },
  ], own);
  await ctx.lookups.ensure('activation_status', [
    { value: 'active', label: 'Active', color: 'red', sort: 10 },
    { value: 'stood_down', label: 'Stood down', color: 'amber', sort: 20 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 30 },
  ], own);
}

/** The values this module adds to shared lists (contract C8), once those lists exist. */
async function sharedValues(ctx: ModuleContext) {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'continuity', label: 'Business continuity', sort: 165 }]);
  }
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'continuity', label: 'Business continuity', color: 'teal', sort: 79, meta: { description: 'A continuity plan is due for review, or a business impact analysis is due.' } },
    ]);
  }
}

/** Personal details kept in the module's own tables (E14-19): anonymizing the record clears them. */
function anonymizeHooks() {
  onAnonymize('continuity_plan', (tx, id) => tx.query(
    `update call_tree_nodes set name = case when name is null then null else $2 end, phone = null, alternate_phone = null,
       notes = case when notes is null then null else $2 end, updated_at = now() where plan_id = $1`, [id, ANONYMIZED_TEXT]));
  onAnonymize('emergency_activation', async (tx, id) => {
    await tx.query('update activation_log_entries set entry = $2, by_name = case when by_name is null then null else $2 end where activation_id = $1', [id, ANONYMIZED_TEXT]);
    await tx.query('update activation_roles set name = case when name is null then null else $2 end where activation_id = $1', [id, ANONYMIZED_TEXT]);
    await tx.query(`update activation_checklist set done_by_name = case when done_by_name is null then null else $2 end,
       note = case when note is null then null else $2 end where activation_id = $1`, [id, ANONYMIZED_TEXT]);
  });
}

async function register(ctx: ModuleContext) {
  // Modules seed in key order, so the action and notification lists exist only by now.
  await sharedValues(ctx);
  registerProcesses(ctx);
  registerBia(ctx);
  registerPlans(ctx);
  registerActivations(ctx);
  registerGaps(ctx);
  await registerContinuityReminders(ctx);
  anonymizeHooks();
}

const mod: ModuleDef = {
  key: 'continuity',
  seedDefaults,
  register,
  seed: seedContinuity,
};
export default mod;
