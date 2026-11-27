// E41-08: safety and security certification of capital projects.
//
// A project carries certifiable items (record type `cert_item`): the parts of the work that must be
// shown safe and secure before they are used, such as a vehicle type, a signal system, a station or a
// fare system. Each item has requirements (`cert_requirement`) derived from a hazard (safety module),
// a threat (a risk in the risks module) or another basis such as a design standard; each requirement
// is verified with evidence (a reference, a note or files attached to it). An item is verified when it
// has requirements and none is open. A certificate of readiness (`project_certificates`) lists every
// item and the open ones that were accepted; it cannot be issued while a required item is open, and it
// is withdrawn automatically when a required item opens again. A gate template may require one
// (`requires_certificate`, service.ts).
//
// Visibility: both types follow the project's department scope (E41-01). A requirement derived from a
// restricted record (every risk) is restricted itself (core `restrictedFrom`). Figures on the
// Certification tab count every requirement for everyone; restricted ones show no detail.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, todayInZone } from '../../core/timezone.ts';
import type { ProjectService } from './service.ts';

type Req = FastifyRequest | null;

/** The record types a requirement may be derived from: a hazard, or a threat kept as a risk. */
export const SOURCE_TYPES = ['hazard', 'risk'] as const;
/** Requirement statuses that close it. */
export const CLOSED = ['verified', 'not_applicable'];

const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const itemLabel = (i: Row) => [i.ref, i.name].filter(Boolean).join(' ');

/** Whether a required item is still open: no requirements yet, or one not verified or not applicable. */
export function itemOpen(total: number, open: number): boolean {
  return total === 0 || open > 0;
}

export function registerCertification(ctx: ModuleContext, svc: ProjectService): void {
  const { db } = ctx;
  const atomic = <T>(fn: () => Promise<T>): Promise<T> => (db.atomic ? db.atomic(fn) : fn());
  const invalid = (fields: Record<string, string>) => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  // The project's department scopes both types (E41-01): a role scoped to departments sees the
  // certification of its departments' projects. The column is the project's, kept in step (resource.ts).
  const scope = { department: 'department_id' };
  const department = { label: 'Department', type: 'ref', to: 'department', readOnly: true } as const;
  const projectDepartment = async (projectId: string) =>
    (await db.one<{ department_id: string | null }>('select department_id from projects where id = $1', [projectId]))?.department_id ?? null;

  /** Serializes certification changes on one project (issuing against reopening). */
  async function lockProject(projectId: string): Promise<void> {
    await db.query('select id from projects where id = $1 for update', [projectId]);
  }

  // ---------- certifiable items ----------

  ctx.defineResource({
    type: 'cert_item', table: 'project_cert_items', module: 'projects',
    label: 'Certifiable item', plural: 'Certifiable items',
    path: '/api/certifiable-items', route: '/projects/certifiable-items', titleField: 'name',
    ref: { field: 'ref', prefix: 'CI-' },
    scope,
    searchable: ['name', 'description'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      project_id: { label: 'Project', type: 'ref', to: 'project', required: true },
      name: { label: 'Item', type: 'text', required: true },
      description: { label: 'What it covers', type: 'longtext', personal: false },
      category: { label: 'Category', type: 'lookup', list: 'cert_item_category' },
      required: { label: 'Required for the certificate', type: 'boolean', default: true },
      owner_id: { label: 'Owner', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'cert_item_status', readOnly: true, default: 'open' },
      requirements_total: { label: 'Requirements', type: 'number', readOnly: true },
      requirements_open: { label: 'Requirements open', type: 'number', readOnly: true },
      department_id: department,
    },
    hooks: {
      async beforeCreate(_req, data) {
        await lockProject(String(data.project_id));
        return { ...data, status: 'open', requirements_total: 0, requirements_open: 0, department_id: await projectDepartment(String(data.project_id)) };
      },
      async beforeUpdate(_req, existing, patch) {
        if (patch.project_id !== undefined && patch.project_id !== existing.project_id) {
          invalid({ project_id: 'A certifiable item stays with its project. Add a new item to the other project instead.' });
        }
        await lockProject(existing.project_id);
        const { department_id: _d, ...rest } = patch;
        return rest;
      },
      async afterCreate(req, row) {
        if (row.required) await recheck(row.project_id, req);
      },
      async afterUpdate(req, before, after) {
        if (before.required !== after.required && after.required) await recheck(after.project_id, req);
      },
    },
  });

  // ---------- requirements ----------

  ctx.defineResource({
    type: 'cert_requirement', table: 'project_cert_requirements', module: 'projects',
    label: 'Certification requirement', plural: 'Certification requirements',
    path: '/api/certification-requirements', route: '/projects/certification-requirements', titleField: 'title',
    ref: { field: 'ref', prefix: 'CR-' },
    // A requirement derived from a restricted record (a threat kept as a risk) is restricted too.
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'source_id' },
    scope,
    evidence: true,
    searchable: ['title', 'requirement', 'basis', 'evidence_ref'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      item_id: { label: 'Certifiable item', type: 'ref', to: 'cert_item', required: true },
      project_id: { label: 'Project', type: 'ref', to: 'project', readOnly: true },
      title: { label: 'Requirement', type: 'text', required: true },
      requirement: { label: 'What must be true', type: 'longtext', personal: false },
      source_type: { label: 'Derived from (record type)', type: 'text' },
      source_id: { label: 'Derived from (record)', type: 'text' },
      basis: { label: 'Other basis', type: 'text' },
      verification_method: { label: 'Verification method', type: 'lookup', list: 'cert_verification_method' },
      status: { label: 'Status', type: 'lookup', list: 'cert_requirement_status', default: 'open' },
      owner_id: { label: 'Verifier', type: 'user' },
      due_on: { label: 'Due', type: 'date' },
      evidence_ref: { label: 'Evidence reference', type: 'text' },
      verification_notes: { label: 'Verification notes', type: 'longtext' },
      verified_by: { label: 'Verified by', type: 'user', readOnly: true },
      verified_on: { label: 'Verified on', type: 'date', readOnly: true },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      department_id: department,
    },
    hooks: {
      async beforeCreate(req, data) {
        const item = await needItem(data.item_id);
        await lockProject(item.project_id);
        const out: Row = { ...data, project_id: item.project_id, department_id: await projectDepartment(item.project_id) };
        checkSource(out, out);
        await applyStatus(req, null, out);
        return out;
      },
      async beforeUpdate(req, existing, patch) {
        const out: Row = { ...patch };
        delete out.project_id;
        delete out.department_id;
        if (out.item_id !== undefined && out.item_id !== existing.item_id) {
          const item = await needItem(out.item_id);
          if (item.project_id !== existing.project_id) invalid({ item_id: 'Choose an item of the same project.' });
        }
        await lockProject(existing.project_id);
        if ('source_type' in out || 'source_id' in out) checkSource({ ...existing, ...out }, out);
        await applyStatus(req, existing, out);
        return out;
      },
      async afterCreate(req, row) {
        await refreshItem(row.item_id);
        await recheck(row.project_id, req);
      },
      async afterUpdate(req, before, after) {
        await refreshItem(after.item_id);
        if (before.item_id !== after.item_id) await refreshItem(before.item_id);
        await recheck(after.project_id, req);
      },
    },
  });

  async function needItem(id: unknown): Promise<Row> {
    const row = typeof id === 'string' && UUID_RE.test(id)
      ? await db.one<Row>('select * from project_cert_items where id = $1 and deleted_at is null', [id])
      : undefined;
    return row ?? invalid({ item_id: 'Choose a certifiable item.' });
  }

  /** A requirement is derived from a hazard or a threat (a risk), or neither; `out` receives the cleaned values. */
  function checkSource(merged: Row, out: Row): void {
    const type = blank(merged.source_type) ? null : String(merged.source_type);
    const id = blank(merged.source_id) ? null : String(merged.source_id);
    if (!type && !id) {
      if ('source_type' in out) out.source_type = null;
      if ('source_id' in out) out.source_id = null;
      return;
    }
    if (!type) invalid({ source_type: 'Say whether the requirement comes from a hazard or a threat.' });
    if (!(SOURCE_TYPES as readonly string[]).includes(type!)) invalid({ source_type: 'A requirement is derived from a hazard or a threat (a risk).' });
    if (!ctx.resources.get(type!)) invalid({ source_type: type === 'hazard' ? 'Hazards are not available in this installation.' : 'Risks are not available in this installation.' });
    if (!id || !UUID_RE.test(id)) invalid({ source_id: type === 'hazard' ? 'Choose the hazard.' : 'Choose the threat.' });
    out.source_type = type;
    out.source_id = id;
  }

  let filesTable: boolean | null = null;
  async function hasFiles(id: string): Promise<boolean> {
    filesTable ??= Boolean((await db.one<{ ok: boolean }>(`select to_regclass('attachments') is not null as ok`))?.ok);
    if (!filesTable) return false;
    return Boolean(await db.one(`select 1 from attachments where record_type = 'cert_requirement' and record_id = $1 and deleted_at is null limit 1`, [id]));
  }

  /**
   * Verified needs a method and evidence (a reference, a note or an attached file); not applicable
   * needs a reason. Closing records who and when; reopening clears it.
   */
  async function applyStatus(req: Req, existing: Row | null, out: Row): Promise<void> {
    const merged = { ...(existing ?? {}), ...out };
    const status = String(merged.status ?? 'open');
    const errors: Record<string, string> = {};
    const closing = existing ? existing.status !== status : true;
    if (status === 'verified' && (closing || 'verification_method' in out || 'evidence_ref' in out || 'verification_notes' in out)) {
      if (blank(merged.verification_method)) errors.verification_method = 'Say how the requirement was verified.';
      if (blank(merged.evidence_ref) && blank(merged.verification_notes) && !(existing && (await hasFiles(existing.id)))) {
        errors.evidence_ref = 'Give the verification evidence: a reference, a note, or a file attached to the requirement.';
      }
    }
    if (status === 'not_applicable' && blank(merged.verification_notes)) errors.verification_notes = 'Say why the requirement does not apply.';
    if (Object.keys(errors).length) invalid(errors);
    const wasClosed = existing ? CLOSED.includes(existing.status) : false;
    const nowClosed = CLOSED.includes(status);
    if (nowClosed && (!existing || existing.status !== status)) {
      out.verified_by = actorOf(req).id;
      // E18-94: a load keeps the verification date it gives.
      out.verified_on = isDataLoad(req) && merged.verified_on ? merged.verified_on : todayInZone();
    } else if (!nowClosed && wasClosed) {
      out.verified_by = null;
      out.verified_on = null;
    }
  }

  /** Keeps an item's status and counts in step with its requirements. */
  async function refreshItem(itemId: string): Promise<void> {
    await db.query(
      `update project_cert_items i set requirements_total = c.total, requirements_open = c.open,
              status = case when c.total > 0 and c.open = 0 then 'verified' else 'open' end
       from (select count(*)::int as total, (count(*) filter (where status not in ('verified', 'not_applicable')))::int as open
             from project_cert_requirements where item_id = $1 and deleted_at is null) c
       where i.id = $1`, [itemId]);
  }

  /** Required items that are open: they stop the certificate. */
  async function requiredOpen(projectId: string): Promise<Row[]> {
    return db.query<Row>(
      `select id, ref, name, requirements_total, requirements_open from project_cert_items
       where project_id = $1 and deleted_at is null and required and (requirements_total = 0 or requirements_open > 0)
       order by ref, name`, [projectId]);
  }

  async function inForce(projectId: string): Promise<Row | undefined> {
    return db.one<Row>(`select * from project_certificates where project_id = $1 and status = 'issued'`, [projectId]);
  }

  async function notify(input: Row): Promise<void> {
    if (!ctx.app.hasDecorator('notify')) return;
    await (ctx.app as unknown as { notify(i: Row): Promise<unknown> }).notify(input);
  }

  /** A certificate in force is withdrawn when a required item is open again. */
  async function recheck(projectId: string, req: Req): Promise<void> {
    const cert = await inForce(projectId);
    if (!cert) return;
    const open = await requiredOpen(projectId);
    if (!open.length) return;
    const reason = `Withdrawn automatically: ${open.map(itemLabel).join('; ')} ${open.length === 1 ? 'is' : 'are'} open again.`;
    await withdraw(req, projectId, cert, reason, true);
  }

  async function withdraw(req: Req, projectId: string, cert: Row, reason: string, automatic: boolean): Promise<Row> {
    const who = req?.user?.displayName ?? 'System';
    const saved = (await db.one<Row>(
      `update project_certificates set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2, withdrawn_by_name = $3,
              withdraw_reason = $4, updated_at = now()
       where id = $1 and status = 'issued' returning *`, [cert.id, req?.user?.id ?? null, who, reason]))!;
    const project = await db.one<Row>('select id, ref, name, project_manager_id, sponsor_id from projects where id = $1', [projectId]);
    const label = [project?.ref, project?.name].filter(Boolean).join(' ');
    await ctx.audit(req, {
      action: 'project.certificate_withdraw', recordType: 'project', recordId: projectId,
      summary: `Certificate of readiness withdrawn (${label}): ${reason}`,
      before: { certificate: cert.id, status: 'issued' }, after: { certificate: cert.id, status: 'withdrawn', reason },
    });
    if (automatic && project) {
      await notify({
        kind: 'general', userIds: [project.project_manager_id, project.sponsor_id].filter(Boolean), permission: 'projects.view',
        recordType: 'project', recordId: projectId, route: `/projects/${projectId}?tab=certification`,
        title: `Certificate of readiness withdrawn: ${label}`,
        body: 'A required certifiable item is open again. Verify it and issue a new certificate.',
      });
    }
    return saved;
  }

  // A deleted item takes its requirements with it; a deleted requirement can leave its item open.
  ctx.resources.onChange?.(async (c) => {
    if (c.action !== 'delete') return;
    if (c.def.type === 'cert_item') {
      const gone = await db.query<Row>(
        `update project_cert_requirements set deleted_at = now(), updated_by = $2 where item_id = $1 and deleted_at is null returning id, ref`,
        [c.row.id, c.req?.user?.id ?? null]);
      for (const r of gone) {
        await ctx.audit(c.req, {
          action: 'cert_requirement.delete', recordType: 'cert_requirement', recordId: r.id,
          summary: `Certification requirement deleted with its item ${itemLabel(c.row)}`,
        });
      }
    } else if (c.def.type === 'cert_requirement') {
      await refreshItem(c.row.item_id);
      await recheck(c.row.project_id, c.req);
    }
  });

  // ---------- the Certification tab ----------

  async function sourceView(r: Row, user: SessionUser | null | undefined): Promise<Row | null> {
    if (!r.source_type || !r.source_id) return null;
    const def = ctx.resources.get(r.source_type);
    if (!def) return null; // its area is switched off or not installed
    const row = user && ctx.can(user, `${def.module}.view`) ? await ctx.resources.find(def.type, r.source_id, user) : undefined;
    if (!row) return { type: def.type, type_label: def.label, id: null, label: `A ${def.label.toLowerCase()} you cannot open`, ref: null, route: null };
    return {
      type: def.type, type_label: def.label, id: row.id, label: row[def.titleField] ?? def.label,
      ref: def.ref ? row[def.ref.field] ?? null : null, route: `${def.route}/${row.id}`,
    };
  }

  async function overview(project: Row, user: SessionUser | null | undefined) {
    const items = await db.query<Row>(
      `select i.*, u.display_name as owner_name from project_cert_items i left join users u on u.id = i.owner_id
       where i.project_id = $1 and i.deleted_at is null order by i.ref, i.name`, [project.id]);
    // Every requirement counts for everyone; one the reader may not see shows no detail.
    const reqs = await db.query<Row>(
      `select r.*, (${ctx.resources.visibleWhere('cert_requirement', user, 'r')}) as visible,
              u.display_name as owner_name, v.display_name as verified_by_name
       from project_cert_requirements r
       left join users u on u.id = r.owner_id left join users v on v.id = r.verified_by
       where r.project_id = $1 and r.deleted_at is null order by r.ref, r.title`, [project.id]);
    const ids = reqs.filter((r) => r.visible).map((r) => r.id);
    filesTable ??= Boolean((await db.one<{ ok: boolean }>(`select to_regclass('attachments') is not null as ok`))?.ok);
    const files = new Map<string, number>(filesTable && ids.length ? (await db.query<{ record_id: string; n: number }>(
      `select record_id, count(*)::int as n from attachments where record_type = 'cert_requirement' and record_id = any($1::uuid[]) and deleted_at is null group by record_id`,
      [ids])).map((f) => [f.record_id, f.n]) : []);
    const reqViews = new Map<string, Row[]>();
    for (const r of reqs) {
      const view: Row = r.visible
        ? {
            id: r.id, ref: r.ref, title: r.title, requirement: r.requirement, visible: true, restricted: r.restricted === true,
            status: r.status, verification_method: r.verification_method, owner_id: r.owner_id, owner_name: r.owner_name,
            due_on: r.due_on ? day(r.due_on) : null, basis: r.basis, evidence_ref: r.evidence_ref, verification_notes: r.verification_notes,
            verified_by_name: r.verified_by_name, verified_on: r.verified_on ? day(r.verified_on) : null,
            source: await sourceView(r, user), files: files.get(r.id) ?? 0, updated_at: r.updated_at,
          }
        : { id: null, ref: null, title: 'A restricted requirement', visible: false, restricted: true, status: r.status };
      reqViews.set(r.item_id, [...(reqViews.get(r.item_id) ?? []), view]);
    }
    const itemViews = items.map((i) => ({
      id: i.id, ref: i.ref, name: i.name, description: i.description, category: i.category, required: i.required === true,
      owner_id: i.owner_id, owner_name: i.owner_name, status: i.status,
      requirements_total: i.requirements_total, requirements_open: i.requirements_open,
      open: itemOpen(i.requirements_total, i.requirements_open),
      requirements: reqViews.get(i.id) ?? [],
    }));
    const blockers = itemViews.filter((i) => i.required && i.open);
    const certificates = await db.query<Row>(
      'select * from project_certificates where project_id = $1 order by created_at desc', [project.id]);
    const current = certificates.find((c) => c.status === 'issued') ?? null;
    const gates = await db.query<{ name: string }>(
      'select name from project_gate_defs where active and requires_certificate order by sort');
    const count = (pred: (r: Row) => boolean) => reqs.filter(pred).length;
    return {
      project_id: project.id,
      summary: {
        items: items.length,
        required_items: itemViews.filter((i) => i.required).length,
        items_open: itemViews.filter((i) => i.open).length,
        required_open: blockers.length,
        requirements: reqs.length,
        requirements_open: count((r) => !CLOSED.includes(r.status)),
        requirements_verified: count((r) => r.status === 'verified'),
        requirements_not_applicable: count((r) => r.status === 'not_applicable'),
      },
      // How many requirements this reader cannot see the details of (restricted); the figures above count them.
      hidden: count((r) => !r.visible),
      items: itemViews,
      blockers: blockers.map((i) => ({ id: i.id, ref: i.ref, name: i.name, requirements_total: i.requirements_total, requirements_open: i.requirements_open })),
      open_items: itemViews.filter((i) => !i.required && i.open).map((i) => ({ id: i.id, ref: i.ref, name: i.name, requirements_open: i.requirements_open, requirements_total: i.requirements_total })),
      can_issue: Boolean(user && ctx.can(user, 'projects.approve')) && !current && items.length > 0 && blockers.length === 0,
      certificate: current ? certificateView(current) : null,
      history: certificates.map(certificateView),
      gates_requiring: gates.map((g) => g.name),
      sources: SOURCE_TYPES.filter((t) => ctx.resources.get(t)),
    };
  }

  function certificateView(c: Row): Row {
    return {
      id: c.id, status: c.status, scope: c.scope, conditions: c.conditions,
      issued_by_name: c.issued_by_name, issued_by_role: c.issued_by_role, issued_on: day(c.issued_on),
      items: c.items ?? [], open_items: c.open_items ?? [],
      withdrawn_at: c.withdrawn_at ? new Date(c.withdrawn_at).toISOString() : null,
      withdrawn_by_name: c.withdrawn_by_name, withdraw_reason: c.withdraw_reason,
    };
  }

  async function issue(req: FastifyRequest, project: Row, body: Row): Promise<Row> {
    const scopeText = String(body.scope ?? '').trim();
    const conditions = String(body.conditions ?? '').trim() || null;
    const role = String(body.issued_by_role ?? '').trim() || null;
    const issuedOn = blank(body.issued_on) ? todayInZone() : String(body.issued_on);
    const errors: Record<string, string> = {};
    if (!scopeText) errors.scope = 'Say what the certificate covers, for example "Revenue service of the new low-floor buses".';
    if (scopeText.length > 2000) errors.scope = 'Keep it under 2,000 characters.';
    if (conditions && conditions.length > 8000) errors.conditions = 'Keep it under 8,000 characters.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(issuedOn))) errors.issued_on = 'Enter a date (YYYY-MM-DD).';
    else if (issuedOn > todayInZone()) errors.issued_on = 'The date cannot be in the future.';
    if (Object.keys(errors).length) invalid(errors);
    if (project.status === 'cancelled') ctx.fail(409, 'project_cancelled', 'A canceled project cannot be certified.');
    const saved = await atomic(async () => {
      await lockProject(project.id);
      if (await inForce(project.id)) ctx.fail(409, 'certificate_in_force', 'A certificate of readiness is already in force. Withdraw it before issuing another.');
      const items = await db.query<Row>(
        `select id, ref, name, required, status, requirements_total, requirements_open from project_cert_items
         where project_id = $1 and deleted_at is null order by ref, name`, [project.id]);
      if (!items.length) ctx.fail(409, 'nothing_to_certify', 'The project has no certifiable items. Add the items to certify first.');
      const open = items.filter((i) => i.required && itemOpen(i.requirements_total, i.requirements_open));
      if (open.length) {
        ctx.fail(409, 'certification_open',
          `The certificate cannot be issued while required items are open: ${open.map(itemLabel).join('; ')}. Verify each requirement (or mark it not applicable with a reason).`);
      }
      const snapshot = items.map((i) => ({
        id: i.id, ref: i.ref, name: i.name, required: i.required === true,
        status: itemOpen(i.requirements_total, i.requirements_open) ? 'open' : 'verified',
        requirements_total: i.requirements_total, requirements_open: i.requirements_open,
      }));
      const row = (await db.one<Row>(
        `insert into project_certificates (project_id, status, scope, conditions, issued_by, issued_by_name, issued_by_role, issued_on, items, open_items)
         values ($1, 'issued', $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb) returning *`,
        [project.id, scopeText, conditions, actorOf(req).id, actorOf(req).name, role, issuedOn,
          JSON.stringify(snapshot), JSON.stringify(snapshot.filter((i) => i.status === 'open'))]))!;
      await ctx.audit(req, {
        action: 'project.certificate_issue', recordType: 'project', recordId: project.id,
        summary: `Certificate of readiness issued (${[project.ref, project.name].filter(Boolean).join(' ')}) by ${req.user!.displayName}: ${scopeText}`
          + (row.open_items.length ? `. Open items accepted: ${row.open_items.map(itemLabel).join('; ')}` : ''),
        after: { certificate: row.id, scope: scopeText, conditions, issued_on: issuedOn, items: snapshot.length, open_items: row.open_items.length },
      });
      return row;
    });
    // The current gate may now be ready for its decision.
    const fresh = await db.one<Row>('select * from projects where id = $1', [project.id]);
    const gate = fresh ? await db.one<Row>(
      `select id, name, gate_def_id from project_gates where project_id = $1 and from_stage = $2 and status <> 'approved' and requires_certificate`,
      [project.id, fresh.stage]) : undefined;
    if (fresh && gate && (await svc.gateReady(fresh, gate.id))) await svc.notifyGateReady(fresh, gate.name, gate.gate_def_id);
    return certificateView(saved);
  }

  async function needCertificate(project: Row, id: string): Promise<Row> {
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from project_certificates where id = $1 and project_id = $2', [id, project.id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Certificate not found.');
  }

  async function pdf(req: FastifyRequest, project: Row, cert: Row): Promise<Buffer> {
    const categories = new Map((await ctx.lookups.values('cert_item_category')).map((v) => [v.value, v.label]));
    const current = await db.query<Row>('select id, category from project_cert_items where project_id = $1', [project.id]);
    const categoryOf = new Map(current.map((i) => [i.id, i.category ? categories.get(i.category) ?? i.category : '']));
    const label = [project.ref, project.name].filter(Boolean).join(' ');
    const doc = new PdfBuilder({
      title: 'Certificate of readiness', subtitle: label, lang: 'en-US', author: req.user?.displayName,
      meta: [`Printed ${dayInZone()} by ${req.user?.displayName ?? 'the application'}`],
      watermark: cert.status === 'withdrawn' ? 'Withdrawn: no longer in force' : null,
      branding: await printBranding(db),
    });
    doc.keyValues([
      { label: 'Project', value: label },
      { label: 'Certifies as ready', value: String(cert.scope) },
      { label: 'Issued on', value: day(cert.issued_on) },
      { label: 'Issued by', value: [cert.issued_by_name, cert.issued_by_role].filter(Boolean).join(', ') },
      { label: 'Status', value: cert.status === 'issued' ? 'In force' : `Withdrawn ${cert.withdrawn_at ? day(cert.withdrawn_at) : ''}${cert.withdraw_reason ? `: ${cert.withdraw_reason}` : ''}` },
    ]);
    doc.paragraph('Every required certifiable item below had its safety and security requirements verified, or recorded as not applicable with a reason, when this certificate was issued.');
    const items = (cert.items ?? []) as Row[];
    const open = (cert.open_items ?? []) as Row[];
    doc.heading('Certifiable items', 2);
    doc.table(
      [{ header: 'Reference', weight: 1 }, { header: 'Item', weight: 3 }, { header: 'Category', weight: 2 }, { header: 'Required', weight: 1 }, { header: 'Requirements verified', weight: 2 }, { header: 'Status', weight: 1 }],
      items.map((i) => [
        String(i.ref ?? ''), String(i.name ?? ''), categoryOf.get(i.id) ?? '', i.required ? 'Yes' : 'No',
        `${Number(i.requirements_total ?? 0) - Number(i.requirements_open ?? 0)} of ${i.requirements_total ?? 0}`,
        i.status === 'open' ? 'Open' : 'Verified',
      ]),
    );
    doc.heading('Open items', 2);
    if (open.length) {
      doc.paragraph('These items are not required for readiness and were still open when the certificate was issued. They were accepted, and must be closed as the conditions below say.');
      doc.table(
        [{ header: 'Reference', weight: 1 }, { header: 'Item', weight: 4 }, { header: 'Requirements open', weight: 2 }],
        open.map((i) => [String(i.ref ?? ''), String(i.name ?? ''), String(i.requirements_open ?? 0)]),
      );
    } else {
      doc.paragraph('None: every certifiable item was verified.');
    }
    doc.heading('Conditions and restrictions', 2);
    doc.paragraph(cert.conditions ? String(cert.conditions) : 'None recorded.');
    return doc.finish();
  }

  // ---------- routes ----------

  const view = { preHandler: ctx.requirePerm('projects.view') };
  const approve = { preHandler: ctx.requirePerm('projects.approve') };
  const params = (req: { params: unknown }) => req.params as Record<string, string>;

  ctx.app.get('/api/projects/:id/certification', view, async (req) =>
    overview(await svc.needProject(params(req).id, req), req.user));
  ctx.describeRoute({
    method: 'GET', path: '/api/projects/:id/certification', tag: 'Projects', permission: 'projects.view',
    summary: 'A project\'s certification: certifiable items, their requirements and evidence, what stops the certificate of readiness, and the certificates issued',
  });

  ctx.app.post('/api/projects/:id/certificates', approve, async (req, reply) => {
    const out = await issue(req, await svc.needProject(params(req).id, req), (req.body ?? {}) as Row);
    reply.code(201);
    return out;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/projects/:id/certificates', tag: 'Projects', permission: 'projects.approve',
    summary: 'Issues the certificate of readiness (refused with 409 while a required certifiable item is open)',
    body: '{ scope: string, conditions?: string | null, issued_by_role?: string | null, issued_on?: date (default today, never in the future) }',
  });

  ctx.app.post('/api/projects/:id/certificates/:certId/withdraw', approve, async (req) => {
    const project = await svc.needProject(params(req).id, req);
    const reason = String(((req.body ?? {}) as Row).reason ?? '').trim();
    if (!reason) invalid({ reason: 'Say why the certificate is withdrawn.' });
    return atomic(async () => {
      await lockProject(project.id);
      const cert = await needCertificate(project, params(req).certId);
      if (cert.status !== 'issued') ctx.fail(409, 'not_in_force', 'This certificate has already been withdrawn.');
      return certificateView(await withdraw(req, project.id, cert, reason, false));
    });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/projects/:id/certificates/:certId/withdraw', tag: 'Projects', permission: 'projects.approve',
    summary: 'Withdraws a certificate of readiness, with a reason', body: '{ reason: string }',
  });

  ctx.app.get('/api/projects/:id/certificates/:certId/pdf', view, async (req, reply) => {
    const project = await svc.needProject(params(req).id, req);
    const cert = await needCertificate(project, params(req).certId);
    const body = await pdf(req, project, cert);
    await ctx.audit(req, {
      action: 'project.certificate_print', recordType: 'project', recordId: project.id,
      summary: `Certificate of readiness printed (${[project.ref, project.name].filter(Boolean).join(' ')})`,
    });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="certificate-of-readiness-${String(project.ref ?? project.id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(body);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/projects/:id/certificates/:certId/pdf', tag: 'Projects', permission: 'projects.view',
    summary: 'A certificate of readiness as a PDF: what it certifies, every certifiable item, the open items accepted and the conditions',
  });

  // ---------- My work and the compliance calendar ----------

  defineCalendarSource(ctx.app, {
    key: 'projects.certification', label: 'Certification requirements I verify', kind: 'Certification requirements',
    recordType: 'cert_requirement', permission: 'projects.view', work: true, anyone: true,
    async events(c, user, from, to, calendarScope) {
      const rows = await c.db.query<Row>(
        `select r.id, r.ref, r.title, r.due_on::text as d, r.owner_id from project_cert_requirements r
         join projects p on p.id = r.project_id and p.deleted_at is null
         where r.deleted_at is null and ${c.resources.visibleWhere('cert_requirement', user, 'r')}
           and r.owner_id is not null and ($1::uuid is null or r.owner_id = $1)
           and r.status not in ('verified', 'not_applicable') and r.due_on between $2::date and $3::date
         order by r.due_on, r.id limit 2000`, [whoFor(user, calendarScope), from, to]);
      return rows.map((r) => ({
        uid: `projects.certification:${r.id}:${day(r.d)}`, title: `Verify: ${r.title}`,
        start: day(r.d), allDay: true, url: `/projects/certification-requirements/${r.id}`, recordType: 'cert_requirement', recordId: r.id,
        ref: r.ref ?? null, personId: r.owner_id ?? null,
      }));
    },
  });
}
