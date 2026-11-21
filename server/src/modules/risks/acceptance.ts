import type { FastifyReply, FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

// Risk acceptance on the shared approval workflows (E08-23). The risk's owner asks for acceptance
// (expiry and rationale); the "Risk acceptance" workflow routes it, with an "Executive approver"
// step only when the risk's rating is at or above its scale's approval threshold (the risk field
// `acceptance_executive`). Approval records the acceptance as before (approver, date, expiry) and
// the risk becomes Accepted; rejection leaves the risk as it was, with the reason in its history.
// Recording an acceptance given outside the application, and revoking one, are unchanged.

export const KIND = 'risk_acceptance';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(v));

interface Deps {
  riskPre: (action: string) => ((req: FastifyRequest, reply: FastifyReply) => Promise<void>)[];
  visibleRisk: (req: FastifyRequest) => Promise<Row>;
  acceptanceRule: (risk: Row) => Promise<{ rating: string | null; rating_label: string | null; threshold_label: string | null; executive_required: boolean }>;
  today: () => Promise<string>;
}

/** The workflow a new installation (or one upgrading from the hand-recorded acceptance) starts with. */
export const DEFAULT_ACCEPTANCE_WORKFLOW = {
  name: 'Risk acceptance',
  description: 'Accepting a risk instead of treating it further. A risk approver decides; when the risk is rated at or above its scale\'s approval '
    + 'threshold an executive approver decides too, who must be someone other than the risk approver. Name your executives in the second step '
    + '(they need permission to see restricted records).',
  steps: [
    { key: 'risk-approver', name: 'Risk approver', approvers: { kind: 'permission', permission: 'risks.approve' }, quorum: 'any' },
    {
      key: 'executive', name: 'Executive approver', approvers: { kind: 'permission', permission: 'risks.approve' }, quorum: 'any',
      conditions: [{ field: 'acceptance_executive', op: 'set' }],
      // AZ-7: the executive step needs a second person; the risk approver cannot decide it too.
      distinct_approvers: true,
    },
  ],
};

export function registerAcceptanceWorkflow(ctx: ModuleContext, deps: Deps) {
  const { db, app } = ctx;
  const engine = () => approvalEngine(app);

  defineApprovalKind(app, {
    key: KIND, recordType: 'risk', label: 'Risk acceptance',
    startsWhen: 'The risk\'s owner asks for the risk to be accepted (with an expiry date and the reason)',
    outcome: 'Approved: the acceptance is recorded (approver, date, expiry) and the risk becomes Accepted; rejected: the risk stays as it was, with the reason in its history',
    approverPermission: 'risks.approve',
    async install(h) {
      // Acceptance was recorded directly before (no request waited), so there is nothing to adopt.
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_ACCEPTANCE_WORKFLOW);
    },
    async onFinish(e) {
      if (e.outcome === 'canceled') return;
      const risk = await db.one<Row>('select * from risks where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!risk) throw new Error('The risk no longer exists.');
      const d = e.instance.data as { expires_on?: string; rationale?: string; rating?: string | null; executive_required?: boolean };
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'risk.acceptance_rejected', recordType: 'risk', recordId: risk.id,
          summary: `Acceptance of ${risk.ref} rejected by ${e.approverName ?? 'an approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}: ${e.comment ?? 'no reason given'}`,
          after: { workflow: e.instance.name, reason: e.comment, expires_on: d.expires_on ?? null },
        });
        return;
      }
      const today = await deps.today();
      if (!d.expires_on || d.expires_on <= today) {
        throw new Error(`The expiry date asked for (${d.expires_on ?? 'none'}) has passed, so no acceptance was recorded. Ask again with a later date.`);
      }
      const approver = `${e.approverName ?? 'An approver'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      const row = (await db.one<Row>(
        `insert into risk_acceptances (risk_id, approver_name, approver_title, approved_on, expires_on, reference, rationale, rating_at_acceptance, executive_required, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [risk.id, approver, d.executive_required ? 'Executive approver (approval workflow)' : null, today, d.expires_on,
          `Approval workflow "${e.instance.name}"`, d.rationale ?? '', d.rating ?? risk.residual_rating ?? risk.inherent_rating ?? null,
          Boolean(d.executive_required), e.approverId],
      ))!;
      await ctx.audit(e.req, {
        action: 'risk.accept', recordType: 'risk', recordId: risk.id,
        summary: `Risk acceptance recorded for ${risk.ref}: approved by ${approver} through the approval workflow, expires ${row.expires_on}`,
        after: row,
      });
      // The acceptance exists now, so the "accepted" status passes the risk's own check. System work,
      // as the engine applies every outcome (BS-6): the approver's own lifecycle rights and a held
      // move do not apply to the result of an approval already given.
      await ctx.resources.update('risk', risk.id, { status: 'accepted', treatment: 'accept' }, null);
    },
  });

  app.post('/api/risks/:id/acceptance-request', { preHandler: deps.riskPre('edit') }, async (req, reply) => {
    const risk = await deps.visibleRisk(req);
    const eng = engine();
    if (!eng) ctx.fail(409, 'approvals_unavailable', 'Approval workflows are not available, so record the acceptance by hand.');
    const b = (req.body ?? {}) as Row;
    const text = (k: string) => String(b[k] ?? '').trim();
    const rule = await deps.acceptanceRule(risk);
    if (!rule.rating) ctx.fail(400, 'not_scored', 'Score the risk before asking for it to be accepted.');
    const today = await deps.today();
    const errors: Record<string, string> = {};
    if (!validDate(text('expires_on'))) errors.expires_on = 'Give the date the acceptance should expire (YYYY-MM-DD).';
    else if (text('expires_on') <= today) errors.expires_on = 'The expiry date must be after today.';
    if (!text('rationale')) errors.rationale = 'Say why the risk should be accepted.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (await eng!.running(KIND, risk.id)) ctx.fail(409, 'already_requested', 'Acceptance of this risk has already been asked for and is waiting for approval.');
    const started = await eng!.start(KIND, risk, {
      requester: req.user!.id, req, note: text('rationale').slice(0, 2000),
      data: { expires_on: text('expires_on'), rationale: text('rationale'), rating: rule.rating, executive_required: rule.executive_required },
    });
    if (!started) {
      ctx.fail(409, 'no_workflow', 'No active Risk acceptance workflow applies to this risk. An administrator can set one up under Administration > Approval workflows, or an approver can record the acceptance by hand.');
    }
    await ctx.audit(req, {
      action: 'risk.acceptance_requested', recordType: 'risk', recordId: risk.id,
      summary: `Acceptance of ${risk.ref} asked for (expires ${text('expires_on')}${rule.executive_required ? ', needs an executive approver' : ''})`,
      after: { workflow: started!.name, expires_on: text('expires_on'), rationale: text('rationale'), executive_required: rule.executive_required },
    });
    reply.code(201);
    return { instance_id: started!.id, workflow: started!.name, status: (await eng!.latest(KIND, risk.id))?.status ?? started!.status };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/risks/:id/acceptance-request', tag: 'Risks', permission: 'risks.edit',
    summary: 'Ask for a risk to be accepted: starts the Risk acceptance approval workflow (also needs security.view)',
    body: '{ expires_on: date, rationale: string }', response: '{ instance_id, workflow, status }',
  });

  app.get('/api/risks/:id/acceptance-request', { preHandler: deps.riskPre('view') }, async (req) => {
    const risk = await deps.visibleRisk(req);
    const eng = engine();
    const latest = eng ? await eng.latest(KIND, risk.id) : null;
    return {
      available: Boolean(eng && (await eng.definitions(KIND)).length),
      request: latest ? {
        id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt,
        expires_on: latest.data.expires_on ?? null, rationale: latest.data.rationale ?? null, executive_required: Boolean(latest.data.executive_required),
      } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/risks/:id/acceptance-request', tag: 'Risks', permission: 'risks.view',
    summary: 'The newest request to accept a risk through the approval workflow, and whether one can be asked for',
    response: '{ available, request: { id, workflow, status, started_at, finished_at, expires_on, rationale, executive_required } | null }',
  });

  return {
    /** An acceptance was recorded by hand: a request still waiting is no longer needed. */
    async settledByHand(risk: Row, req: FastifyRequest) {
      const eng = engine();
      if (eng) await eng.cancel(KIND, risk.id, 'The acceptance was recorded by hand.', req);
    },
  };
}
