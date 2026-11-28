// Register templates (wave 26): ready-made registers an administrator creates in one click under
// Administration > Registers (labor agreements, real property). A template is only a starting point: it
// defines an ordinary register (names, numbering, menu place, icon), its status list and its fields as
// custom fields, all of which the administrator may change afterwards. Templates are invented and
// jurisdiction-neutral, and are created only on request: nothing is created at start-up or by the
// pilot seed (the dev seed makes them as "[Sample]" registers).
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { adminRoute, body, invalid } from '../admin/shared.ts';
import { checkRegister, createRegister } from './admin.ts';
import { statusList, typeOf, type RegisterRow, type Registers } from './definitions.ts';

type FieldType = 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'boolean' | 'select' | 'ref';

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  section?: string;
  /** select: [value, label] pairs. */
  options?: [string, string][];
  /** ref: the record type linked to; when it is not loaded or is switched off, `fallback` is used instead. */
  to?: string;
  fallback?: Omit<TemplateField, 'to' | 'fallback' | 'key'>;
}

export interface RegisterTemplate {
  key: string;
  label: string;
  plural: string;
  prefix: string;
  nav_group: string;
  icon: string;
  title_label: string;
  evidence: boolean;
  description: string;
  /** Replaces the default statuses (Open, In progress, Closed). */
  statuses: { value: string; label: string; color: string }[];
  fields: TemplateField[];
}

export const TEMPLATES: RegisterTemplate[] = [
  {
    key: 'labor_agreements', label: 'Labor agreement', plural: 'Labor agreements', prefix: 'LA', nav_group: 'People and training', icon: 'users',
    title_label: 'Agreement', evidence: false,
    description: 'Collective bargaining and other labor agreements: the bargaining unit, parties, term and reopener dates, covered positions, wage schedule and grievance procedure.',
    statuses: [
      { value: 'negotiating', label: 'In negotiation', color: 'blue' },
      { value: 'in_effect', label: 'In effect', color: 'green' },
      { value: 'expired', label: 'Expired, terms continue', color: 'amber' },
      { value: 'superseded', label: 'Superseded', color: 'gray' },
    ],
    fields: [
      { key: 'bargaining_unit', label: 'Bargaining unit or union', type: 'text', section: 'Parties and term', help: 'The bargaining unit or union as named in the agreement.' },
      { key: 'parties', label: 'Parties', type: 'longtext', section: 'Parties and term', help: 'Every party to the agreement, one per line.' },
      { key: 'term_start', label: 'Term starts', type: 'date', section: 'Parties and term' },
      { key: 'term_end', label: 'Term ends', type: 'date', section: 'Parties and term' },
      { key: 'next_reopener', label: 'Next reopener', type: 'date', section: 'Parties and term', help: 'The next date on which terms may be reopened.' },
      { key: 'reopener_terms', label: 'Reopener dates and terms', type: 'longtext', section: 'Parties and term', help: 'Every reopener date and what may be reopened then.' },
      { key: 'covered_position', label: 'Main covered position', type: 'ref', to: 'position', section: 'Coverage', help: 'Link further positions under Related.',
        fallback: { label: 'Main covered position', type: 'text', section: 'Coverage' } },
      { key: 'covered_positions', label: 'Covered positions and classifications', type: 'longtext', section: 'Coverage' },
      { key: 'wage_schedule', label: 'Wage schedule notes', type: 'longtext', section: 'Coverage', help: 'Steps, increases and their dates.' },
      { key: 'grievance_document', label: 'Grievance procedure document', type: 'ref', to: 'policy', section: 'Coverage', help: 'The document of the document library that sets out the grievance procedure.',
        fallback: { label: 'Grievance procedure (where it is kept)', type: 'text', section: 'Coverage' } },
    ],
  },
  {
    key: 'real_property', label: 'Property', plural: 'Real property', prefix: 'RP', nav_group: 'Assets', icon: 'building',
    title_label: 'Property', evidence: true,
    description: 'Land and buildings the organization owns or holds: how and when each was acquired and paid for, its use and condition, appraisals, leases and easements, and disposal.',
    statuses: [
      { value: 'in_use', label: 'In use', color: 'green' },
      { value: 'surplus', label: 'Surplus, identified for disposal', color: 'amber' },
      { value: 'disposal', label: 'Disposal in progress', color: 'blue' },
      { value: 'disposed', label: 'Disposed', color: 'gray' },
    ],
    fields: [
      { key: 'address', label: 'Address', type: 'longtext', section: 'Property' },
      { key: 'parcel_ref', label: 'Parcel or legal reference', type: 'text', section: 'Property', help: 'The parcel number or legal description reference used where the property is recorded.' },
      { key: 'acquired_on', label: 'Acquired', type: 'date', section: 'Acquisition' },
      {
        key: 'acquisition_method', label: 'How acquired', type: 'select', section: 'Acquisition',
        options: [['purchase', 'Purchase'], ['donation', 'Donation or gift'], ['transfer', 'Transfer from another body'], ['lease_purchase', 'Lease-purchase'], ['other', 'Other']],
      },
      { key: 'funding_source', label: 'Funding source', type: 'text', section: 'Acquisition', help: 'How the acquisition was paid for, for example a named grant or the organization\'s own funds.' },
      {
        key: 'current_use', label: 'Use', type: 'select', section: 'Use and condition',
        options: [['operations', 'Operations or maintenance'], ['passenger', 'Passenger facility'], ['administration', 'Administration'], ['parking', 'Parking'], ['leased_out', 'Leased to others'], ['vacant', 'Vacant'], ['other', 'Other']],
      },
      {
        key: 'condition', label: 'Condition', type: 'select', section: 'Use and condition',
        options: [['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor']],
      },
      { key: 'appraised_value', label: 'Appraised value', type: 'currency', section: 'Use and condition' },
      { key: 'appraised_on', label: 'Appraised on', type: 'date', section: 'Use and condition' },
      { key: 'leases_easements', label: 'Leases and easements', type: 'longtext', section: 'Use and condition', help: 'Leases to or from others and easements on the property, with their dates.' },
      { key: 'disposed_on', label: 'Disposed on', type: 'date', section: 'Disposal' },
      { key: 'disposal_notes', label: 'Disposal method and proceeds', type: 'longtext', section: 'Disposal' },
    ],
  },
];

/** The fields of a template as they will be made here: a link to a record type that is not available becomes its fallback. */
export function fieldsFor(ctx: ModuleContext, t: RegisterTemplate): (Omit<TemplateField, 'fallback'>)[] {
  return t.fields.map(({ fallback, ...f }) => (f.type === 'ref' && (!f.to || !ctx.resources.get(f.to)) && fallback ? { ...fallback, key: f.key } : f));
}

/** Adds the template's statuses in place of the default ones (a new register has no records yet). */
async function applyStatuses(ctx: ModuleContext, key: string, t: RegisterTemplate) {
  const list = statusList(key);
  await ctx.lookups.ensure(list, t.statuses.map((s, i) => ({ ...s, sort: (i + 1) * 10 })), { module: key });
  await ctx.db.query(`update lookups set active = false where list_key = $1 and value <> all($2::text[])`, [list, t.statuses.map((s) => s.value)]);
}

/**
 * Adds the template's fields as custom fields. With a request, through the custom-field route itself
 * as the same administrator (its checks, its audit entry, and the field list applies at once in this
 * process); without one (the sample data), directly.
 */
async function applyFields(ctx: ModuleContext, key: string, t: RegisterTemplate, req: FastifyRequest | null): Promise<string[]> {
  const type = typeOf(key);
  const made: string[] = [];
  for (const [i, f] of fieldsFor(ctx, t).entries()) {
    if (await ctx.db.one('select 1 from custom_fields where record_type = $1 and key = $2', [type, f.key])) continue;
    const payload = {
      record_type: type, key: f.key, label: f.label, type: f.type, position: (i + 1) * 10, help: f.help ?? '', section: f.section ?? '',
      ...(f.options ? { options: f.options.map(([value, label]) => ({ value, label })) } : {}),
      ...(f.type === 'ref' ? { to: f.to } : {}),
    };
    if (req) {
      const headers: Record<string, string> = { 'x-grc-csrf': '1', 'content-type': 'application/json' };
      for (const h of ['cookie', 'authorization']) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
      const res = await ctx.app.inject({ method: 'POST', url: '/api/admin/custom-fields', headers, payload: JSON.stringify(payload) });
      if (res.statusCode >= 300) throw new Error(`The field "${f.label}" could not be added: ${res.body}`);
    } else {
      let list: string | null = null;
      if (f.options) {
        list = `cf_${type}_${f.key}`;
        await ctx.lookups.ensure(list, f.options.map(([value, label], n) => ({ value, label, color: 'gray', sort: (n + 1) * 10 })), { module: key });
      }
      await ctx.db.query(
        `insert into custom_fields (record_type, key, label, type, required, list_key, ref_type, section, position, help) values ($1,$2,$3,$4,false,$5,$6,$7,$8,$9)`,
        [type, f.key, f.label, f.type, list, f.type === 'ref' ? f.to : null, f.section ?? null, payload.position, f.help ?? null]);
    }
    made.push(f.key);
  }
  return made;
}

/**
 * Creates a register from a template. `overrides` may change its names, key and prefix (to make a
 * second one, or when the template's are taken). Returns the register.
 */
export async function createFromTemplate(
  ctx: ModuleContext, regs: Registers, t: RegisterTemplate, overrides: Row, req: FastifyRequest | null,
): Promise<{ register: RegisterRow; fields: string[] }> {
  const values = await checkRegister(ctx, regs, {
    key: overrides.key ?? t.key, label: overrides.label ?? t.label, plural: overrides.plural ?? t.plural, prefix: overrides.prefix ?? t.prefix,
    nav_group: overrides.nav_group ?? t.nav_group, icon: t.icon, title_label: t.title_label, evidence: t.evidence, description: overrides.description ?? t.description,
  }, null);
  const register = await createRegister(ctx, regs, values, req);
  if (regs.state.get(register.key) !== 'ready') return { register, fields: [] };
  await applyStatuses(ctx, register.key, t);
  const fields = await applyFields(ctx, register.key, t, req);
  await ctx.audit(req, {
    action: 'register.template', recordType: 'register_definition', recordId: register.id,
    summary: `Register "${register.plural}" made from the template "${t.plural}" (${fields.length} fields, ${t.statuses.length} statuses)`,
  });
  return { register, fields };
}

export function registerTemplateRoutes(ctx: ModuleContext, regs: Registers, shapeOf: (r: RegisterRow) => Promise<unknown>) {
  adminRoute(ctx, 'GET', '/api/admin/registers/templates', async () => {
    await regs.sync();
    const used = new Set([...regs.rows.values()].map((r) => r.key));
    const prefixes = new Set([...regs.rows.values()].map((r) => r.prefix));
    return {
      templates: TEMPLATES.map((t) => ({
        key: t.key, label: t.label, plural: t.plural, prefix: `${t.prefix}-`, nav_group: t.nav_group, icon: t.icon, description: t.description,
        statuses: t.statuses.map((s) => s.label),
        fields: fieldsFor(ctx, t).map((f) => ({ key: f.key, label: f.label, type: f.type, to: f.type === 'ref' ? f.to : undefined })),
        // Already made under its own key, or its prefix is taken: a second one needs other names.
        made: used.has(t.key), prefixTaken: prefixes.has(`${t.prefix}-`),
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/registers/templates', tag: 'Registers', permission: 'admin.administer',
    summary: 'Ready-made registers that can be created in one click (labor agreements, real property)',
    response: '{ templates: [{ key, label, plural, prefix, nav_group, icon, description, statuses, fields: [{ key, label, type, to? }], made, prefixTaken }] }',
  });

  adminRoute(ctx, 'POST', '/api/admin/registers/templates/:template', async (req, reply) => {
    const t = TEMPLATES.find((x) => x.key === String((req.params as Row).template));
    if (!t) invalid({ template: 'Choose one of the templates offered.' });
    const b = body(req);
    const overrides: Row = {};
    for (const k of ['key', 'label', 'plural', 'prefix', 'nav_group', 'description']) if (typeof b[k] === 'string' && b[k].trim()) overrides[k] = b[k];
    const { register } = await createFromTemplate(ctx, regs, t!, overrides, req);
    reply.code(201);
    return shapeOf(register);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/registers/templates/:template', tag: 'Registers', permission: 'admin.administer',
    summary: 'Create a register from a template, with its statuses and fields',
    description: 'The template\'s names, key and prefix are used unless others are given (for a second register from the same template). Fields linking to a part of the application that is not available are made as text fields. Everything can be changed afterwards like any register.',
    body: '{ key?, label?, plural?, prefix?, nav_group?, description? }', response: 'The register',
  });
}
