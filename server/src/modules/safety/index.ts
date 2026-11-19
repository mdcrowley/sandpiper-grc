import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerEvents } from './events.ts';
import { registerHazards } from './hazards.ts';
import { registerIndicators } from './indicators.ts';
import { registerPortalIntake } from './portal-intake.ts';
import { registerReminders } from './reminders.ts';
import { seedSafety } from './seed.ts';

/**
 * Safety management: the hazard log (scored on the risks module's safety hazard matrix),
 * safety events with their investigation and corrective actions, the links between events
 * and hazards, safety performance indicators over exposure the operator enters, and
 * notifications for serious events and overdue corrective actions. Permission module `safety`;
 * events flagged `restricted` (personal information) also need `security.view`.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'safety' };
  // meta.restrict: events of this type usually hold personal information, so they start restricted.
  await ctx.lookups.ensure('safety_event_type', [
    { value: 'collision', label: 'Collision', color: 'red', sort: 10 },
    { value: 'passenger_injury', label: 'Passenger injury', color: 'orange', sort: 20, meta: { restrict: true } },
    { value: 'near_miss', label: 'Near miss', color: 'amber', sort: 30 },
    { value: 'operator_assault', label: 'Assault on an operator', color: 'purple', sort: 40, meta: { restrict: true } },
    { value: 'fire', label: 'Fire', color: 'red', sort: 50 },
    { value: 'derailment', label: 'Derailment', color: 'red', sort: 60 },
    { value: 'unsafe_condition', label: 'Unsafe condition', color: 'blue', sort: 70 },
    { value: 'slip_trip_fall', label: 'Slip, trip or fall', color: 'teal', sort: 80 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  // meta.notify: a new event at this severity (or raised to it) is announced to the safety team.
  await ctx.lookups.ensure('safety_event_severity', [
    { value: 'no_harm', label: 'No injury or damage', color: 'gray', sort: 10 },
    { value: 'minor', label: 'Minor', color: 'blue', sort: 20 },
    { value: 'moderate', label: 'Moderate', color: 'amber', sort: 30 },
    { value: 'serious', label: 'Serious', color: 'orange', sort: 40, meta: { notify: true } },
    { value: 'major', label: 'Major or fatal', color: 'red', sort: 50, meta: { notify: true } },
  ], own);
  // meta.final: the event is closed; closing needs a root cause and no open corrective actions.
  await ctx.lookups.ensure('safety_event_status', [
    { value: 'reported', label: 'Reported', color: 'blue', sort: 10 },
    { value: 'investigating', label: 'Under investigation', color: 'amber', sort: 20 },
    { value: 'actions_open', label: 'Corrective actions open', color: 'orange', sort: 30 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 40, meta: { final: true } },
  ], own);
  await ctx.lookups.ensure('root_cause_category', [
    { value: 'human_factors', label: 'Human factors', sort: 10 },
    { value: 'equipment', label: 'Equipment or vehicle', sort: 20 },
    { value: 'procedure', label: 'Procedure or training', sort: 30 },
    { value: 'infrastructure', label: 'Infrastructure', sort: 40 },
    { value: 'environment', label: 'Weather or environment', sort: 50 },
    { value: 'third_party', label: 'Third party', sort: 60 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ctx.lookups.ensure('hazard_source', [
    { value: 'safety_event', label: 'Safety event', sort: 10 },
    { value: 'inspection', label: 'Inspection', sort: 20 },
    { value: 'audit', label: 'Audit', sort: 30 },
    { value: 'staff_report', label: 'Staff report', sort: 40 },
    { value: 'change', label: 'Change or new service', sort: 50 },
    { value: 'risk_assessment', label: 'Risk assessment', sort: 60 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  // meta.closed: no longer an open hazard (left out of the dashboard's matrix).
  await ctx.lookups.ensure('hazard_status', [
    { value: 'identified', label: 'Identified', color: 'blue', sort: 10 },
    { value: 'mitigating', label: 'Being mitigated', color: 'amber', sort: 20 },
    { value: 'controlled', label: 'Controlled', color: 'green', sort: 30 },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 40, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('safety_exposure_measure', [
    { value: 'vehicle_miles', label: 'Vehicle-miles', sort: 10 },
    { value: 'vehicle_hours', label: 'Vehicle-hours', sort: 20 },
    { value: 'boardings', label: 'Boardings', sort: 30 },
  ], own);
  // Corrective actions and mitigations are filed under "Safety" in the action tracker.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'safety', label: 'Safety', sort: 145 }]);
  }
  // So that people can switch safety notifications off on their own.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'safety', label: 'Safety events', color: 'red', sort: 75, meta: { description: 'A serious safety event has been reported, or a corrective action is overdue.' } },
    ]);
  }
}

async function register(ctx: ModuleContext) {
  registerHazards(ctx);
  registerEvents(ctx);
  registerIndicators(ctx);
  registerPortalIntake(ctx);
  await registerReminders(ctx);
}

const mod: ModuleDef = {
  key: 'safety',
  seedDefaults,
  register,
  seed: seedSafety,
};
export default mod;
