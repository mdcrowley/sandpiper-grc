// E45-34: the incident's next step as one button. The next status in the lifecycle list, what reaching it
// means, and the checks it needs: a blocking check must pass before the button moves the incident on;
// a warning is shown and recorded but does not stop it. The status bar's steps still allow any move the
// lifecycle rules allow (an administrator's escape hatch); the button is the guided path.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { lifecycle, type Stage } from './defaults.ts';

export interface StepCheck {
  key: string;
  label: string;
  ok: boolean;
  /** True: the button refuses until this passes. False: a warning only. */
  blocking: boolean;
  /** The workspace tab where it is put right. */
  tab?: string;
  detail?: string;
}

export interface NextStep {
  current: { value: string; label: string; stage: Stage };
  next: { value: string; label: string; stage: Stage; action: string } | null;
  checks: StepCheck[];
  ready: boolean;
}

/** The button's wording for reaching a status. */
function actionFor(next: { value: string; label: string; stage: Stage }, current: Stage): string {
  if (next.stage === 'declared' && current === 'reported') return 'Declare incident';
  if (next.stage === 'closed') return 'Close incident';
  return `Mark ${next.label.toLowerCase()}`;
}

export function makeNextStep(ctx: ModuleContext) {
  const { db } = ctx;

  async function nextStep(incident: Row): Promise<NextStep> {
    const statuses = await lifecycle(ctx);
    const at = statuses.findIndex((s) => s.value === incident.status);
    const cur = statuses[at] ?? { value: String(incident.status), label: String(incident.status), stage: 'reported' as Stage };
    const following = at >= 0 && cur.stage !== 'closed' ? statuses[at + 1] : undefined;
    const current = { value: cur.value, label: cur.label, stage: cur.stage };
    if (!following) return { current, next: null, checks: [], ready: false };
    const next = { value: following.value, label: following.label, stage: following.stage, action: actionFor(following, cur.stage) };

    const checks: StepCheck[] = [];
    const answered = Boolean(incident.answers_confirmed_at);
    const steps = await db.query<{ phase: string; open: number }>(
      `select phase, count(*) filter (where not done)::int as open from incident_checklist_items
       where incident_id = $1 and deleted_at is null group by phase`, [incident.id]);
    const openIn = (phase: string) => steps.find((s) => s.phase === phase)?.open ?? 0;
    const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

    // Declaring: the clocks start from the answers on the Affected tab.
    if (next.stage === 'declared') {
      checks.push({
        key: 'answers', label: 'Affected questions answered', ok: answered, blocking: false, tab: 'affected',
        detail: answered ? undefined : 'Without the answers no notification clock can start. You can declare now and answer them straight after.',
      });
      checks.push({ key: 'lead', label: 'Incident lead named', ok: Boolean(incident.lead_id), blocking: false, tab: 'roles' });
    }
    // Containing (and any later step at the contained stage, such as recovering).
    if (next.stage === 'contained') {
      checks.push({ key: 'lead', label: 'Incident lead named', ok: Boolean(incident.lead_id), blocking: false, tab: 'roles' });
      const containment = openIn('containment');
      checks.push({
        key: 'containment', label: 'Containment checklist done', ok: containment === 0, blocking: false, tab: 'checklists',
        detail: containment ? `${plural(containment, 'step')} still open.` : undefined,
      });
    }
    if (next.stage === 'closed') {
      checks.push({
        key: 'answers', label: 'Affected questions answered', ok: answered, blocking: true, tab: 'affected',
        detail: answered ? undefined : 'Answer them, or confirm the answers shown, so the notification duties are known before closing.',
      });
      const pending = (await db.one<{ n: number }>(
        `select count(*)::int as n from notification_tasks where incident_id = $1 and deleted_at is null and status = 'pending' and required`,
        [incident.id]))!.n;
      checks.push({
        key: 'notifications', label: 'Required notifications made', ok: pending === 0, blocking: true,
        detail: pending ? `${plural(pending, 'required notification')} still pending. Record each as done or not required.` : undefined,
      });
      checks.push({
        key: 'ransom', label: 'Ransom decision recorded', ok: incident.ransom_payment_status !== 'under_consideration', blocking: true, tab: 'ransom',
        detail: incident.ransom_payment_status === 'under_consideration' ? 'A ransom payment is still under consideration.' : undefined,
      });
      const left = openIn('containment') + openIn('recovery');
      checks.push({
        key: 'checklists', label: 'Checklists done', ok: left === 0, blocking: false, tab: 'checklists',
        detail: left ? `${plural(left, 'step')} still open.` : undefined,
      });
    }
    return { current, next, checks, ready: checks.every((c) => c.ok || !c.blocking) };
  }

  /** Moves the incident to its next status when every blocking check passes. */
  async function advance(req: FastifyRequest, incident: Row, expected: unknown): Promise<{ incident: Row; step: NextStep }> {
    const step = await nextStep(incident);
    if (!step.next) ctx.fail(409, 'no_next_step', 'This incident is closed: there is no next step.');
    if (expected !== undefined && expected !== null && expected !== step.next!.value) {
      ctx.fail(409, 'stale', 'The incident has moved on since this page was loaded. Reload it and try again.');
    }
    const failing = step.checks.filter((c) => c.blocking && !c.ok);
    if (failing.length) {
      ctx.fail(409, 'checks', `Before "${step.next!.action.toLowerCase()}": ${failing.map((c) => c.label.toLowerCase()).join('; ')}.`);
    }
    const updated = await ctx.resources.update('security_incident', incident.id, { status: step.next!.value }, req);
    return { incident: updated, step: await nextStep(updated) };
  }

  return { nextStep, advance };
}
