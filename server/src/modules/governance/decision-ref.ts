// A committee decision as the approval of a record in another area (wave 26: E45-64 the audit plan,
// E45-56 the risk appetite). Other modules ask through the `committeeDecision` decorator (guard with
// `app.hasDecorator('committeeDecision')`; it is missing while governance is off or not loaded), so they
// never read this module's tables: given a decision id, it answers the decision when the caller may see
// it and it was carried (outcome "approved"), with the meeting's date and the committee's name.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

export interface CommitteeDecision {
  id: string; ref: string | null; title: string; resolution_number: string | null;
  meeting_id: string; meeting_ref: string | null; decided_on: string; committee_id: string; committee_name: string;
  /** "Board of Directors, resolution R-2026-03" or "…, decision DEC-00012". */
  reference: string;
}

/** The decision, or a reason it cannot approve something (not found, not carried). */
export type DecisionAnswer = { ok: true; decision: CommitteeDecision } | { ok: false; message: string };

export function registerDecisionRef(ctx: ModuleContext) {
  const lookup = async (req: FastifyRequest, id: unknown): Promise<DecisionAnswer> => {
    const d = typeof id === 'string' && UUID_RE.test(id) && ctx.can(req.user, 'governance.view')
      ? await ctx.resources.find('meeting_decision', id, req.user) : undefined;
    if (!d) return { ok: false, message: 'Choose a decision of a committee meeting.' };
    if (d.outcome !== 'approved') return { ok: false, message: 'Choose a decision that was carried (approved).' };
    const m = await ctx.db.one<Row>(
      `select m.id, m.ref, m.scheduled_at, c.id as committee_id, c.name from meetings m join committees c on c.id = m.committee_id
       where m.id = $1 and m.deleted_at is null`, [d.meeting_id]);
    if (!m) return { ok: false, message: 'The meeting of that decision no longer exists.' };
    return {
      ok: true,
      decision: {
        id: String(d.id), ref: d.ref ?? null, title: String(d.title ?? ''), resolution_number: d.resolution_number ?? null,
        meeting_id: String(m.id), meeting_ref: m.ref ?? null, decided_on: todayInZone(new Date(m.scheduled_at)),
        committee_id: String(m.committee_id), committee_name: String(m.name),
        reference: `${m.name}, ${d.resolution_number ? `resolution ${d.resolution_number}` : `decision ${d.ref}`}`,
      },
    };
  };
  if (!ctx.app.hasDecorator('committeeDecision')) ctx.app.decorate('committeeDecision', lookup);
}
