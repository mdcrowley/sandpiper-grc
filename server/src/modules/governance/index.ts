import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { registerAgenda } from './agenda.ts';
import { registerBook } from './book.ts';
import { registerCommittees } from './committees.ts';
import { registerDecisions } from './decisions.ts';
import { registerDeclarations } from './declarations.ts';
import { registerWorkPlan } from './workplan.ts';
import { registerDecisionRef } from './decision-ref.ts';
import { registerInvitations } from './invitations.ts';
import { registerMeetings } from './meetings.ts';
import { registerMemberView } from './members.ts';
import { registerMinutes } from './minutes.ts';
import { registerMotions } from './motions.ts';
import { registerGovernanceReminders } from './reminders.ts';
import { seedGovernance } from './seed.ts';
import { registerGovernanceSummary } from './summary.ts';

/**
 * Committees and meetings (E28): committees with their members by side and a quorum rule; meetings
 * with an agenda, a frozen report pack, attendance and minutes the chair approves; a register of
 * decisions, linked to the records decided, which can complete an approval step waiting for the
 * chair; and the actions agreed at a meeting. Permission module and feature area `governance`.
 * Wave 25: agenda items with papers, presenter, time, open or closed session and a consent agenda
 * (agenda.ts, papers.ts); motions with mover, seconder, votes and resolution numbers (motions.ts);
 * minutes per item, approved at a later meeting and published (minutes.ts); the board book and
 * minutes as PDFs (book.ts, with PDF papers appended in a sandbox, book-sandbox.ts); and the member
 * reading view (members.ts).
 * The safety plan's element map and yearly review live with policies (`policies/plans.ts`).
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'governance' };
  await ctx.lookups.ensure('committee_kind', [
    { value: 'governing_body', label: 'Governing body', color: 'purple', sort: 10 },
    { value: 'risk', label: 'Risk committee', color: 'orange', sort: 20 },
    { value: 'safety', label: 'Safety committee', color: 'red', sort: 30 },
    { value: 'audit', label: 'Audit committee', color: 'blue', sort: 40 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  await ctx.lookups.ensure('committee_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'inactive', label: 'Inactive', color: 'gray', sort: 20 },
  ], own);
  await ctx.lookups.ensure('committee_quorum_rule', [
    { value: 'count', label: 'Number of voting members', sort: 10 },
    { value: 'percent', label: 'Percentage of voting members', sort: 20 },
  ], own);
  await ctx.lookups.ensure('committee_frequency', [
    { value: 'monthly', label: 'Every month', sort: 10 },
    { value: 'every_2_months', label: 'Every two months', sort: 20 },
    { value: 'quarterly', label: 'Every quarter', sort: 30 },
    { value: 'half_yearly', label: 'Every six months', sort: 40 },
    { value: 'yearly', label: 'Every year', sort: 50 },
    { value: 'as_needed', label: 'When needed', sort: 60 },
  ], own);
  await ctx.lookups.ensure('committee_side', [
    { value: 'management', label: 'Management', color: 'blue', sort: 10 },
    { value: 'labor', label: 'Labor', color: 'orange', sort: 20 },
    { value: 'independent', label: 'Independent', color: 'purple', sort: 30 },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('committee_role', [
    { value: 'chair', label: 'Chair', color: 'purple', sort: 10 },
    { value: 'member', label: 'Member', color: 'blue', sort: 20 },
    { value: 'alternate', label: 'Alternate', color: 'gray', sort: 30 },
  ], own);
  // meta.final: approved minutes lock the meeting.
  await ctx.lookups.ensure('meeting_status', [
    { value: 'planned', label: 'Planned', color: 'blue', sort: 10 },
    { value: 'agenda_published', label: 'Agenda published', color: 'teal', sort: 20 },
    { value: 'held', label: 'Held', color: 'amber', sort: 30 },
    { value: 'minutes_approved', label: 'Minutes approved', color: 'green', sort: 40, meta: { final: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 50 },
  ], own);
  await ctx.lookups.ensure('decision_outcome', [
    { value: 'approved', label: 'Approved', color: 'green', sort: 10 },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 20 },
    { value: 'noted', label: 'Noted', color: 'blue', sort: 30 },
    { value: 'deferred', label: 'Deferred', color: 'amber', sort: 40 },
  ], own);
}

/** The values this module adds to shared lists (contract C8), once every module has seeded its own lists. */
async function sharedValues(ctx: ModuleContext) {
  // Actions agreed at a meeting are filed under "Meeting" in the action tracker.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'meeting', label: 'Meeting', sort: 155 }]);
  }
  // So that people can switch committee reminders off on their own.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'governance', label: 'Committees and meetings', color: 'purple', sort: 78, meta: { description: 'A meeting pack is due, or minutes are waiting to be written up.' } },
    ]);
  }
}

async function register(ctx: ModuleContext) {
  // Modules seed in key order, so the action and notification lists exist only by now.
  await sharedValues(ctx);
  registerCommittees(ctx);
  registerMeetings(ctx);
  registerAgenda(ctx);
  registerDecisions(ctx);
  registerMotions(ctx);
  // Declarations of interest and recused votes (E45-60).
  registerDeclarations(ctx);
  // The annual work plan of standing items and the agenda posting deadline (E45-62).
  registerWorkPlan(ctx);
  // A carried decision as the approval of a record elsewhere: the audit plan, the risk appetite (E45-64, E45-56).
  registerDecisionRef(ctx);
  registerMinutes(ctx);
  registerBook(ctx);
  registerMemberView(ctx);
  registerInvitations(ctx);
  await registerGovernanceReminders(ctx);
  registerGovernanceSummary(ctx);
  // E28-12: anonymizing a committee at the end of retention also clears the names typed for members
  // with no account or roster person (`committee_members.name` is personal data). The names of the
  // other members are read from their account or roster record, which retention covers on its own.
  onAnonymize('committee', (tx, id) => tx.query(
    `update committee_members set name = $2, created_by = null, updated_by = null, updated_at = now()
     where committee_id = $1 and user_id is null and person_id is null and name is not null returning 1`, [id, ANONYMIZED_TEXT]));
}

const mod: ModuleDef = {
  key: 'governance',
  seedDefaults,
  register,
  seed: seedGovernance,
};
export default mod;
