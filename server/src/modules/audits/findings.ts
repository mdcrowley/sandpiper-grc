// Findings raise corrective action plans (record type `cap`, contract C1, risks module) and hazards
// (record type `hazard`, safety module), each only while that type is available (E24-08).
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { EVIDENCE_TYPE } from './checklists.ts';
import { addDays, isDate } from './dates.ts';
import { AWAITING_VERIFICATION, verificationDays } from './resources.ts';

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

  // ---------- verification before closing (E45-16) ----------

  /** The people who own the fix: the response owner, the plan's responsible person and its action owners. */
  async function fixOwners(f: Row): Promise<Set<string>> {
    const owners = new Set<string>();
    if (f.response_owner_id) owners.add(String(f.response_owner_id));
    if (f.cap_id && ctx.resources.get('cap')) {
      const plan = await ctx.resources.find('cap', String(f.cap_id), null);
      if (plan?.responsible_id) owners.add(String(plan.responsible_id));
      const action = ctx.resources.get('action');
      if (action && 'cap_id' in action.fields) {
        for (const a of await db.query<Row>(`select owner_id from ${action.table} where cap_id = $1 and deleted_at is null and owner_id is not null`, [f.cap_id])) {
          owners.add(String(a.owner_id));
        }
      }
    }
    return owners;
  }

  /** Marks a finding as fixed and waiting for the auditor's verification (system work after the checks). */
  async function markReady(f: Row, req: FastifyRequest | null) {
    const days = await verificationDays(ctx);
    const updated = await ctx.resources.update('audit_finding', f.id, {
      status: AWAITING_VERIFICATION, ...(f.verification_due ? {} : { verification_due: addDays(dayInZone(), days) }),
    }, null);
    if (updated.verifier_id && ctx.app.hasDecorator('notify')) {
      await ctx.app.notify({
        userIds: [updated.verifier_id], kind: 'audits', recordType: 'audit_finding', recordId: f.id, route: `/audit-findings/${f.id}`,
        title: `Ready for your verification: finding ${f.ref}`,
        body: `Check that the fix works and record your verification by ${updated.verification_due ? String(updated.verification_due).slice(0, 10) : 'its due date'}.`,
        once: `audit_finding.ready:${f.id}:${updated.verification_due ?? ''}`,
      });
    }
    if (req) {
      await ctx.audit(req, {
        action: 'audit_finding.ready_for_verification', recordType: 'audit_finding', recordId: f.id,
        summary: `Finding ${f.ref} is ready for the auditor's verification`, after: { verification_due: updated.verification_due },
      });
    }
    return updated;
  }

  app.post('/api/audit-findings/:id/ready-for-verification', edit, async (req) => {
    const f = await needFinding(req);
    if (f.status === 'closed' || f.verified_on) ctx.fail(409, 'verified', 'This finding has already been verified.');
    if (f.status === AWAITING_VERIFICATION) ctx.fail(409, 'already_ready', 'This finding is already waiting for verification.');
    if (!String(f.management_response ?? '').trim() && !f.cap_id) {
      ctx.fail(400, 'validation', 'Record the management response or raise a corrective action plan first.', { management_response: 'Give the response first.' });
    }
    return markReady(f, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-findings/:id/ready-for-verification', tag: 'Audits', permission: 'audits.edit',
    summary: 'Say the fix of a finding is done: it waits for the auditor\'s verification, due after the setting audits.verification_days (30)',
    description: 'The auditor named to verify (by default the audit\'s lead auditor, unless they own the response) is told. A corrective action plan moving to Verifying or Closed does the same by itself.',
    response: 'the finding',
  });

  app.post('/api/audit-findings/:id/verify', edit, async (req) => {
    const f = await needFinding(req);
    if (f.verified_on) ctx.fail(409, 'verified', 'This finding has already been verified.');
    if (!String(f.management_response ?? '').trim() && !f.cap_id) {
      ctx.fail(400, 'validation', 'There is nothing to verify yet: the finding has no management response or corrective action plan.', { status: 'No response yet.' });
    }
    const by = actorOf(req);
    const owners = await fixOwners(f);
    if (by.id && owners.has(by.id)) ctx.fail(403, 'not_independent', 'The fix is verified by an auditor, not by someone who owns the response, the plan or one of its actions.');
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const today = dayInZone();
    const on = typeof b.verified_on === 'string' && b.verified_on ? b.verified_on : today;
    if (!isDate(on) || on > today) errors.verified_on = 'Give the date of the verification, not in the future.';
    const note = text(b.note, 8000);
    if (!note) errors.note = 'Say what you checked and what you found.';
    const files = Array.isArray(b.attachment_ids) ? [...new Set(b.attachment_ids as unknown[])] : [];
    const items = Array.isArray(b.evidence_ids) ? [...new Set(b.evidence_ids as unknown[])] : [];
    if (files.some((x) => typeof x !== 'string' || !UUID_RE.test(x)) || files.length > 20) errors.attachment_ids = 'Files are given as a list of files attached to the finding.';
    if (items.some((x) => typeof x !== 'string' || !UUID_RE.test(x)) || items.length > 20) errors.evidence_ids = 'Evidence items are given as a list of evidence records.';
    if (!files.length && !items.length) errors.attachment_ids = 'Attach the evidence you looked at to the finding, or link an evidence item.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (files.length) {
      const found = await db.query<Row>(
        `select id from attachments where id = any($1::uuid[]) and record_type = 'audit_finding' and record_id = $2 and deleted_at is null`, [files, f.id]).catch(() => []);
      if (found.length !== files.length) ctx.fail(400, 'validation', 'Check the highlighted fields.', { attachment_ids: 'Attach the files to this finding first.' });
    }
    if (items.length) {
      // Evidence library records already linked to the finding (the library's own links).
      if (!ctx.resources.get(EVIDENCE_TYPE)) ctx.fail(409, 'evidence_unavailable', 'The evidence library is not available on this installation; attach the files to the finding instead.');
      for (const id of items) {
        const linked = await db.one(`select 1 from evidence_links where evidence_id = $1 and record_type = 'audit_finding' and record_id = $2`, [id, f.id]);
        if (!linked || !(await ctx.resources.find(EVIDENCE_TYPE, String(id), req.user))) {
          ctx.fail(400, 'validation', 'Check the highlighted fields.', { evidence_ids: 'Link the evidence record to this finding first.' });
        }
      }
    }
    const close = b.close !== false;
    const updated = await ctx.resources.update('audit_finding', f.id, {
      verified_on: on, verified_by: by.id, verified_by_name: by.name, verification_note: note,
      verification_attachment_ids: files, verification_evidence_ids: items,
      ...(close ? { status: 'closed' } : {}),
    }, null);
    await ctx.audit(req, {
      action: 'audit_finding.verify', recordType: 'audit_finding', recordId: f.id,
      summary: `Finding ${f.ref} verified by ${by.name ?? 'an auditor'} on ${on}${close ? ' and closed' : ''}`,
      after: { verified_on: on, note, attachment_ids: files, evidence_ids: items, closed: close },
    });
    return updated;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-findings/:id/verify', tag: 'Audits', permission: 'audits.edit',
    summary: 'Record the auditor\'s verification that a finding was put right (date, note and evidence) and close it',
    description: 'The verifier may not be the response owner, the plan\'s responsible person or an owner of one of its actions (403 `not_independent`). Evidence: files already attached to the finding and/or evidence library records already linked to it (POST /api/evidence-links). `close: false` records the verification without closing. In data load mode `on_behalf_of` names the auditor.',
    body: '{ verified_on? (default today), note, attachment_ids?: string[], evidence_ids?: string[], close?: boolean }', response: 'the finding',
  });

  // A corrective action plan raised from a finding that reaches Verifying or Closed makes the finding
  // ready for the auditor's verification.
  ctx.resources.onChange?.(async (c) => {
    if (c.action !== 'update' || c.def.type !== 'cap' || c.row.source_type !== 'audit_finding' || !c.row.source_id) return;
    const closedPlan = (await ctx.lookups.values('cap_status')).filter((v) => v.meta?.closed === true).map((v) => v.value);
    if (c.row.status !== 'verifying' && !closedPlan.includes(String(c.row.status))) return;
    const f = await db.one<Row>('select * from audit_findings where id::text = $1 and deleted_at is null', [String(c.row.source_id)]);
    if (!f || f.verified_on || f.status === 'closed' || f.status === AWAITING_VERIFICATION) return;
    await markReady(f, null);
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
