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
  system: 'Applications and services the organisation runs.',
  asset: 'Equipment: computers, phones, network devices and the like.',
  site: 'Buildings and locations.',
  data_category: 'Kinds of information the organisation holds.',
  vendor: 'Suppliers and service providers.',
  contract: 'Agreements with vendors, with their dates and value.',
  evidence_item: 'Documents received from vendors, such as certificates.',
  framework: 'Cybersecurity frameworks being followed.',
  framework_outcome: 'The individual outcomes of a framework and how far each is met.',
  assessment_snapshot: 'Dated assessments of framework progress.',
  risk: 'Entries on the risk register.',
  action: 'Agreed follow-up actions from any part of the application.',
  obligation: 'Things the organisation must do by law, contract or policy.',
  security_incident: 'Security incidents and how they were handled.',
  notification_task: 'People who must be told about an incident, with deadlines.',
  project: 'Projects, their stage, rating and money.',
  change: 'Planned changes to systems.',
  policy: 'Policies and when they are due for review.',
  policy_exception: 'Agreed exceptions to policies.',
  course: 'Training courses.',
  exercise: 'Tests and rehearsals of plans.',
  vulnerability: 'Known weaknesses found in systems.',
};

export interface CatalogueField {
  path: string; label: string; type: FieldType; list?: string; to?: string;
  /** Label of the related record this field is reached through. */
  via?: string;
  /** A field an administrator added (`cf_<key>`). */
  custom?: boolean;
  group: boolean; sum: boolean; column: boolean;
}

const usable = (type: FieldType) => ({
  group: type !== 'json' && type !== 'longtext',
  sum: type === 'number' || type === 'currency',
  column: true,
});

export function fieldsOf(ctx: ModuleContext, user: SessionUser | null, def: ResourceDef, custom: CustomDefs = {}): CatalogueField[] {
  const out: CatalogueField[] = [];
  for (const [name, f] of Object.entries({ ...def.fields, ...STD_FIELDS })) {
    out.push({ path: name, label: f.label, type: f.type, list: f.list, to: f.to, ...usable(f.type) });
  }
  // Fields an administrator added to this record type.
  for (const [name, f] of Object.entries(custom)) {
    out.push({ path: name, label: f.label, type: f.type, list: f.list, to: f.to, custom: true, ...usable(f.type) });
  }
  for (const [name, f] of Object.entries({ ...def.fields, ...custom })) {
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

export async function catalogue(ctx: ModuleContext, user: SessionUser | null) {
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
