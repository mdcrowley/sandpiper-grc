// What the report builder offers: the record types the caller may view, in plain words, with
// every field that can be shown, filtered, grouped or totalled (including one hop to related records).
import type { FieldType, ModuleContext, ResourceDef, SessionUser } from '../../core/module.ts';
import { customDefs, type CustomDefs } from './custom.ts';
import { GLOBAL_KINDS, globalField, mayView, reportable, STD_FIELDS, USER_SUBFIELDS } from './spec.ts';

/** One line per record type. Generic wording only; a type without an entry gets a sentence made from its name. */
const DESCRIPTIONS: Record<string, string> = {
  ticket: 'Requests and faults raised with the service desk.',
  problem: 'Underlying causes behind repeated faults.',
  knowledge_article: 'How-to articles and known fixes.',
  catalog_item: 'The things people can ask the service desk for.',
  system: 'Applications and services the organization runs.',
  asset: 'Equipment: computers, phones, network devices and the like.',
  site: 'Buildings and locations.',
  data_category: 'Kinds of information the organization holds.',
  vendor: 'Suppliers and service providers.',
  contract: 'Agreements with vendors, with their dates and value.',
  evidence_item: 'Documents received from vendors, such as certificates.',
  framework: 'Cybersecurity frameworks being followed.',
  framework_outcome: 'The individual outcomes of a framework and how far each is met.',
  assessment_snapshot: 'Dated assessments of framework progress.',
  risk: 'Entries on the risk register.',
  action: 'Agreed follow-up actions from any part of the application.',
  obligation: 'Things the organization must do by law, contract or policy.',
  security_incident: 'Security incidents and how they were handled.',
  notification_task: 'People who must be told about an incident, with deadlines.',
  project: 'Projects, their stage, rating and money.',
  change: 'Planned changes to systems.',
  policy: 'Policies and when they are due for review.',
  policy_exception: 'Agreed exceptions to policies.',
  course: 'Training courses.',
  exercise: 'Tests and rehearsals of plans.',
  vulnerability: 'Known weaknesses found in systems.',
  cap: 'Corrective action plans: the root cause and the actions that fix it.',
  audit_area: 'The audit universe: what needs auditing and how often.',
  audit_engagement: 'Internal audits and reviews, with their stage and opinion.',
  checklist_template: 'Reusable checklists for audits and inspections.',
  inspection_schedule: 'Recurring inspections and what they cover.',
  inspection: 'Inspections carried out, with their result and score.',
  audit_finding: 'Findings from audits and inspections, with the response.',
  audit_request: 'Evidence requested from auditees.',
  control: 'The control library: what each control does and how well it works.',
  control_test: 'Tests of controls, with their result and sign-off.',
  funding_award: 'Grants and other outside funding: funder, period, amount and reporting.',
  funding_certification: 'Yearly certifications to funders and their sign-off.',
  compliance_review: 'Funder compliance reviews and their areas.',
  review_deficiency: 'Deficiencies funders found in their reviews, and how each is corrected.',
  committee: 'Committees and boards, their members and quorum.',
  meeting: 'Committee meetings, their agenda, attendance and minutes.',
  meeting_decision: 'Decisions taken at meetings and what they decided.',
  person: 'The roster of people, with or without an account.',
  position: 'Positions and what each requires.',
  certification: 'Certifications people hold and when they expire.',
  regulatory_change: 'New or changed laws, rules, standards and funding terms, with their impact and status.',
  kri: 'Key risk indicators with their latest monthly value and level (restricted).',
};

export interface CatalogField {
  path: string; label: string; type: FieldType; list?: string; to?: string;
  /** Label of the related record this field is reached through. */
  via?: string;
  /** A field an administrator added (`cf_<key>`). */
  custom?: boolean;
  /** A multi-choice field: a record can hold several values. */
  multiple?: boolean;
  group: boolean; sum: boolean; column: boolean;
}

const usable = (type: FieldType) => ({
  group: type !== 'json' && type !== 'longtext',
  sum: type === 'number' || type === 'currency',
  column: true,
});

export function fieldsOf(ctx: ModuleContext, user: SessionUser | null, def: ResourceDef, custom: CustomDefs = {}): CatalogField[] {
  const out: CatalogField[] = [];
  for (const [name, f] of Object.entries({ ...def.fields, ...STD_FIELDS })) {
    out.push({ path: name, label: f.label, type: f.type, list: f.list, to: f.to, ...usable(f.type) });
  }
  // Fields an administrator added to this record type.
  for (const [name, f] of Object.entries(custom)) {
    // A multi-choice field can be a column, a filter and a group (each record under each of its values).
    out.push({ path: name, label: f.label, type: f.type, list: f.list, to: f.to, custom: true, ...usable(f.type), ...(f.multiple ? { multiple: true, sum: false } : {}) });
  }
  for (const [name, f] of Object.entries({ ...def.fields, ...custom })) {
    if (f.multiple) continue;
    if (f.type === 'user') {
      for (const [sub, uf] of Object.entries(USER_SUBFIELDS)) {
        out.push({ path: `${name}.${sub}`, label: `${f.label}: ${uf.label}`, type: uf.type, via: f.label, ...usable(uf.type) });
      }
    }
    if (f.type !== 'ref') continue;
    const target = ctx.resources.get(f.to!);
    if (!target || !mayView(ctx, user, target)) continue;
    for (const [sub, tf] of Object.entries(target.fields)) {
      if (!['text', 'number', 'currency', 'date', 'datetime', 'boolean', 'lookup'].includes(tf.type)) continue;
      out.push({ path: `${name}.${sub}`, label: `${f.label}: ${tf.label}`, type: tf.type, list: tf.list, via: f.label, ...usable(tf.type) });
    }
  }
  return out;
}

export async function catalog(ctx: ModuleContext, user: SessionUser | null) {
  const defs = ctx.resources.all()
    .filter((d) => reportable(d) && mayView(ctx, user, d))
    .sort((a, b) => a.plural.localeCompare(b.plural));
  const custom = new Map<string, CustomDefs>();
  for (const d of defs) custom.set(d.type, await customDefs(ctx, d.type));
  return defs
    .map((d) => ({
      type: d.type, label: d.label, plural: d.plural, route: d.route, module: d.module,
      description: DESCRIPTIONS[d.type] ?? `Every ${d.label.toLowerCase()} recorded in the application.`,
      restricted: d.restricted === true,
      titleField: d.titleField, refField: d.ref?.field ?? null,
      canExport: mayView(ctx, user, d, 'export'),
      fields: fieldsOf(ctx, user, d, custom.get(d.type)),
      /** Which field each dashboard-wide filter would apply to (absent: it does not apply). */
      globals: Object.fromEntries(GLOBAL_KINDS.map((k) => [k, globalField(d, k)]).filter(([, v]) => v)),
    }));
}
