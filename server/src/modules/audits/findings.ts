// Findings raise corrective action plans (record type `cap`, contract C1, risks module) and hazards
// (record type `hazard`, safety module), each only while that type is available (E24-08).
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function registerFindings(ctx: ModuleContext) {
  const { app, db } = ctx;
  const edit = { preHandler: ctx.requirePerm('audits.edit') };

  const needFinding = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('audit_finding', String((req.params as Row).id ?? ''), req.user)) ?? ctx.fail(404, 'not_found', 'Finding not found.');

  /** The finding's source as a line of text, for the plan or hazard it raises. */
  async function sourceLine(f: Row): Promise<string> {
    const table = f.source_type === 'audit_engagement' ? 'audits' : 'inspections';
    const s = await db.one<Row>(`select ref, title from ${table} where id = $1`, [f.source_id]);
    return s ? `${f.source_type === 'audit_engagement' ? 'Audit' : 'Inspection'} ${[s.ref, s.title].filter(Boolean).join(' ')}` : '';
  }

  async function link(f: Row, toType: string, toId: string, req: FastifyRequest) {
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('audit_finding', $1, $2, $3, 'raised', $4)
       on conflict do nothing`, [f.id, toType, toId, req.user!.id]);
  }

  // However a plan is raised for a finding (here, or from the plan panel on the finding's page), the
  // finding records it: the first plan raised becomes its corrective action plan.
  ctx.resources.onChange?.(async (c) => {
    if (c.action !== 'create' || c.def.type !== 'cap' || c.row.source_type !== 'audit_finding' || !c.row.source_id) return;
    const f = await db.one<Row>('select id, cap_id, responded_on, status from audit_findings where id::text = $1 and deleted_at is null', [String(c.row.source_id)]);
    if (!f || f.cap_id) return;
    await ctx.resources.update('audit_finding', f.id, {
      cap_id: c.row.id, ...(f.status === 'closed' ? {} : { status: 'cap_raised' }), ...(f.responded_on ? {} : { responded_on: dayInZone() }),
    }, null);
  });

  app.post('/api/audit-findings/:id/cap', edit, async (req, reply) => {
    const f = await needFinding(req);
    const cap = ctx.resources.get('cap');
    if (!cap) ctx.fail(409, 'caps_unavailable', 'Corrective action plans are not available on this installation.');
    if (!ctx.can(req.user, 'actions.create')) ctx.fail(403, 'forbidden', 'You need permission to create actions to raise a corrective action plan.');
    if (f.cap_id && (await ctx.resources.find('cap', f.cap_id, null))) ctx.fail(409, 'cap_exists', 'This finding already has a corrective action plan.');
    const b = (req.body ?? {}) as Row;
    const origin = await sourceLine(f);
    const wanted: Row = {
      title: text(b.title, 200) || f.title,
      source: f.source_type === 'inspection' ? 'inspection' : 'audit',
      source_type: 'audit_finding', source_id: f.id,
      problem_statement: text(b.problem_statement, 8000) || [f.condition || f.title, origin && `Raised by finding ${f.ref} (${origin}).`].filter(Boolean).join('\n\n'),
      root_cause: text(b.root_cause, 8000) || f.cause || null,
      responsible_id: b.responsible_id ?? f.response_owner_id ?? null,
      due_on: b.due_on ?? f.response_due ?? null,
    };
    // Only the fields the plan type has (contract C1 names them; a later version may add more).
    const data = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => k in cap!.fields && v !== null && v !== ''));
    const plan = await ctx.resources.create('cap', data, req);
    await ctx.resources.update('audit_finding', f.id, {
      cap_id: plan.id, status: 'cap_raised', ...(f.responded_on ? {} : { responded_on: dayInZone() }),
    }, null);
    await link(f, 'cap', plan.id, req);
    await ctx.audit(req, {
      action: 'audit_finding.cap', recordType: 'audit_finding', recordId: f.id,
      summary: `Corrective action plan ${plan.ref ?? ''} raised from finding ${f.ref}`.replace(/\s+/g, ' '), after: { cap_id: plan.id },
    });
    reply.code(201);
    return { cap: { id: plan.id, ref: plan.ref ?? null, title: plan.title, route: cap!.route ? `${cap!.route}/${plan.id}` : null } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-findings/:id/cap', tag: 'Audits', permission: 'audits.edit',
    summary: 'Raise a corrective action plan from a finding (also needs actions.create); the finding records the plan',
    description: 'Defaults come from the finding: title, problem statement (condition and source), root cause (cause), responsible person (response owner) and due date (response due). 409 `caps_unavailable` when the corrective action plan type is not loaded or switched off; 409 `cap_exists` when the finding already has one.',
    body: '{ title?, problem_statement?, root_cause?, responsible_id?, due_on? }', response: '{ cap: { id, ref, title, route } }',
  });

  app.post('/api/audit-findings/:id/hazard', edit, async (req, reply) => {
    const f = await needFinding(req);
    const hz = ctx.resources.get('hazard');
    if (!hz) ctx.fail(409, 'hazards_unavailable', 'The hazard log is not available on this installation.');
    if (!ctx.can(req.user, 'safety.create')) ctx.fail(403, 'forbidden', 'You need permission to create safety records to add a hazard.');
    if (f.hazard_id && (await ctx.resources.find('hazard', f.hazard_id, null))) ctx.fail(409, 'hazard_exists', 'This finding already raised a hazard.');
    const b = (req.body ?? {}) as Row;
    let site: string | null = typeof b.site_id === 'string' ? b.site_id : null;
    if (!site && f.source_type === 'inspection') {
      const ins = await db.one<Row>('select target_type, target_id from inspections where id = $1', [f.source_id]);
      if (ins?.target_type === 'site' && ins.target_id) site = ins.target_id;
    }
    const origin = await sourceLine(f);
    const wanted: Row = {
      title: text(b.title, 200) || f.title,
      description: text(b.description, 8000) || [f.condition, origin && `Found by ${origin} (finding ${f.ref}).`].filter(Boolean).join('\n\n'),
      source: f.source_type === 'inspection' ? 'inspection' : 'audit',
      consequence: f.effect || null,
      site_id: site,
    };
    const data = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => k in hz!.fields && v !== null && v !== ''));
    const hazard = await ctx.resources.create('hazard', data, req);
    await ctx.resources.update('audit_finding', f.id, { hazard_id: hazard.id }, null);
    await link(f, 'hazard', hazard.id, req);
    await ctx.audit(req, {
      action: 'audit_finding.hazard', recordType: 'audit_finding', recordId: f.id,
      summary: `Hazard ${hazard.ref ?? ''} added to the hazard log from finding ${f.ref}`.replace(/\s+/g, ' '), after: { hazard_id: hazard.id },
    });
    reply.code(201);
    return { hazard: { id: hazard.id, ref: hazard.ref ?? null, title: hazard.title, route: `${hz!.route}/${hazard.id}` } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-findings/:id/hazard', tag: 'Audits', permission: 'safety.create', // described under the hazard permission so it leaves the API reference while safety is off; also needs audits.edit
    summary: 'Add a hazard to the hazard log from a finding (also needs audits.edit), with source Audit or Inspection',
    description: 'The hazard\'s site is the inspected site when the finding came from an inspection of a site. 409 `hazards_unavailable` while the safety area is off or not installed; 409 `hazard_exists` when the finding already raised one.',
    body: '{ title?, description?, site_id? }', response: '{ hazard: { id, ref, title, route } }',
  });
}
