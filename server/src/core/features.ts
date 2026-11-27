import type { FastifyInstance, FastifyRequest } from 'fastify';
import { inTrial, type Queryable } from './db.ts';
import { fail } from './errors.ts';
import { isApiRequest, routePattern } from './api/versioning.ts';
import type { FieldDef, ResourceDef, ResourceRegistry, Row } from './module.ts';

/**
 * Feature switches (E14-28): optional parts of the application ("areas") that an administrator
 * switches on or off under Administration > Features. The `features` setting holds one boolean per
 * area; an area that is missing from it takes its default (on, except the self-service portal), so
 * an upgrade never makes something disappear.
 *
 * A switched-off area behaves as if its module were not installed, for everyone, administrators
 * and tokens included. Its data is kept; switching it back on restores everything. This file is the
 * one place that says what each area covers:
 *  - `permissions`: permission modules that nobody holds while the area is off (`can()` answers
 *    false, even for `*`), so menus, pages, record links, dashboards and MCP tools disappear;
 *  - `types`: record types hidden besides those whose permission module is off (security incidents
 *    use the shared `security` module, which also governs restricted records, so they are listed);
 *  - `modules`: server module folders whose routes answer 404 "switched off";
 *  - `jobs`: prefixes of the background job types that are skipped while it is off;
 *  - `lookupValues`: values of shared lists that belong to it (an action's source "Risk", the
 *    notification kind "Service-level targets"), left out of every list offered while it is off;
 *  - `fields`: fields of record types that stay on that are about it (a system's vendor name).
 *    Fields that refer to a switched-off record type (`ref` to it) are hidden without being listed.
 *  - `owns`: rows of shared set-up that belong to it, by kind (`role`: default roles such as the
 *    Safety manager; `risk_scale`: the safety hazard matrix). Read with `ownedOff(state, kind, key)`.
 * A list owned by a switched-off area, or used only by its record types, is hidden as a whole.
 * Inventory, the action tracker, notifications, attachments, administration, the Overview and Help
 * are not areas: they are always on.
 */
export interface Area {
  key: string;
  label: string;
  description: string;
  permissions: string[];
  types?: string[];
  modules: string[];
  jobs: string[];
  /** Values of shared lists that belong to this area: `{ <list>: [value] }`. */
  lookupValues?: Record<string, string[]>;
  /** Fields of other record types that are about this area: `{ <type>: [field] }`. */
  fields?: Record<string, string[]>;
  /** Configurable lists of this area that it does not own by permission module (public ones). */
  lists?: string[];
  /**
   * Rows of shared set-up that belong to this area, by kind: `{ role: ['safety_manager'],
   * risk_scale: ['hazard_4x5'] }`. While it is off they are left out of everything offered (the
   * Roles page, a person's roles, the AI assistant roles, the risk scales); rows and grants are kept.
   */
  owns?: Record<string, string[]>;
  /** Areas that must be on for this one to be on. */
  requires?: string[];
  /** On when an administrator has never set it. */
  defaultOn: boolean;
}

export const AREAS: Area[] = [
  {
    key: 'tickets', label: 'Service desk', defaultOn: true,
    description: 'Tickets, problems, the knowledge base and the service catalog.',
    permissions: ['tickets', 'knowledge'], modules: ['tickets'], jobs: ['tickets.'],
    lookupValues: { notification_kind: ['sla'], action_source: ['problem'] },
  },
  {
    key: 'portal', label: 'Self-service portal', defaultOn: false, requires: ['tickets'],
    description: 'Simpler pages where anyone in the organization submits and tracks their own requests. Switch it on together with the Requester role.',
    // Like every other area (E14-34): while off nobody holds the portal permissions, its routes (its
    // settings included) answer "switched off", and its settings tab, menu entry and guide page are hidden.
    // A Requester role keeps its grants, which apply again once the portal is switched on.
    permissions: ['portal'], modules: ['portal'], jobs: ['portal.'],
    fields: { catalog_item: ['portal'] }, owns: { role: ['requester'] },
  },
  {
    key: 'changes', label: 'Change enablement', defaultOn: true,
    description: 'Change requests, approvals, the change calendar and post-implementation reviews.',
    permissions: ['changes'], modules: ['changes'], jobs: ['changes.'],
    lookupValues: { action_source: ['change'] },
  },
  {
    key: 'vendors', label: 'Vendors and contracts', defaultOn: true,
    description: 'Vendors, contracts, renewals and vendor evidence.',
    permissions: ['vendors', 'contracts'], modules: ['vendors'], jobs: ['vendors.'],
    lookupValues: { action_source: ['vendor'], retention_category: ['contractual'] }, fields: { system: ['vendor_name', 'agreement_on_file'] },
  },
  {
    key: 'frameworks', label: 'Framework outcomes', defaultOn: true,
    description: 'Cybersecurity framework outcomes, assessments and target profiles.',
    permissions: ['frameworks'], modules: ['frameworks'], jobs: ['frameworks.'],
    lookupValues: { action_source: ['assessment'] },
  },
  {
    key: 'risks', label: 'Risks and obligations', defaultOn: true,
    description: 'The risk register, risk reviews and acceptances, and compliance obligations. The action tracker stays on.',
    // The risks folder also holds the action tracker, which stays on: its routes are not switched off wholesale.
    permissions: ['risks', 'obligations'], modules: [], jobs: ['risks.', 'obligations.'],
    lookupValues: { action_source: ['risk', 'regulatory_change'] },
  },
  {
    key: 'secincidents', label: 'Security incidents', defaultOn: true,
    description: 'Security incidents, their notification clocks and notification tasks.',
    permissions: [], types: ['security_incident', 'notification_task'], modules: ['secincidents'], jobs: ['secincidents.'],
    lookupValues: { notification_kind: ['clock'], action_source: ['incident'] },
  },
  {
    key: 'policies', label: 'Documents and exceptions', defaultOn: true,
    description: 'Policies, acknowledgments and policy exceptions.',
    permissions: ['policies', 'exceptions'], modules: ['policies'], jobs: ['policies.'],
    lookupValues: { notification_kind: ['acknowledgement'], action_source: ['policy'] },
  },
  {
    key: 'training', label: 'Training and exercises', defaultOn: true,
    description: 'Training courses, assignments and exercises.',
    permissions: ['training', 'exercises'], modules: ['training'], jobs: ['training.'],
    lookupValues: { action_source: ['training', 'exercise'] }, lists: ['training_result'], owns: { role: ['training_coordinator'] },
  },
  {
    key: 'vulnerabilities', label: 'Vulnerabilities', defaultOn: true,
    description: 'Vulnerability records, scanner imports and remediation deadlines.',
    permissions: ['vulnerabilities'], modules: ['vulnerabilities'], jobs: ['vulnerabilities.'],
    lookupValues: { action_source: ['vulnerability'] },
  },
  {
    key: 'projects', label: 'Projects', defaultOn: true,
    description: 'Projects, the portfolio and project reminders.',
    permissions: ['projects'], modules: ['projects'], jobs: ['projects.'],
    lookupValues: { action_source: ['project'] }, owns: { role: ['project_manager'] },
  },
  {
    key: 'reports', label: 'Dashboards and reports', defaultOn: true,
    description: 'Saved dashboards, the report catalog, scheduled reports and report packs. The Overview page and its figures stay.',
    // `dashboards.view` also opens the Overview's figures, which stay: saved dashboards are hidden by type.
    permissions: ['reports'], types: ['dashboard'], modules: ['reports'], jobs: ['reports.'],
  },
  {
    key: 'fleet', label: 'Fleet and services', defaultOn: true,
    description: 'Vehicles, vehicle models, the services (routes and lines) they run, and which systems each depends on.',
    permissions: ['fleet'], modules: ['fleet'], jobs: ['fleet.'],
    lookupValues: { condition_target_type: ['vehicle'] },
  },
  {
    key: 'safety', label: 'Safety management', defaultOn: true,
    description: 'Hazards, safety events, safety performance indicators and safety reporting from the portal.',
    permissions: ['safety'], modules: ['safety'], jobs: ['safety.'],
    lookupValues: { notification_kind: ['safety'], action_source: ['safety'] },
    fields: { change: ['safety_impact'], position: ['safety_sensitive'] },
    owns: { role: ['safety_manager'], risk_scale: ['hazard_4x5'] },
  },
  // Wave 10 (E24, E26, E27, E28). Declared ahead of their modules: a permission module, module folder,
  // job prefix or list value that does not exist yet is simply not there to hide.
  {
    key: 'audits', label: 'Audits and inspections', defaultOn: true,
    description: 'The audit plan and coverage, audit engagements and findings, checklist templates and recurring inspections.',
    permissions: ['audits'], modules: ['audits'], jobs: ['audits.'],
    lookupValues: { action_source: ['inspection'], notification_kind: ['audits'] },
  },
  {
    key: 'controls', label: 'Control library and testing', defaultOn: true,
    description: 'The control library, what each control covers, control tests and their schedule.',
    permissions: ['controls'], modules: ['controls'], jobs: ['controls.'],
    lookupValues: { action_source: ['control'], notification_kind: ['controls'] },
  },
  {
    key: 'funding', label: 'Funding and grant compliance', defaultOn: true,
    description: 'Funding awards and what they fund, yearly certifications, funder compliance reviews and their deficiencies.',
    permissions: ['funding'], modules: ['funding'], jobs: ['funding.'],
    lookupValues: { action_source: ['funding'] },
  },
  {
    key: 'governance', label: 'Committees and meetings', defaultOn: true,
    description: 'Committees and their members, meetings with agendas, packs and minutes, and the decisions register.',
    permissions: ['governance'], modules: ['governance'], jobs: ['governance.'],
    lookupValues: { action_source: ['meeting'], notification_kind: ['governance'] },
  },
  // Wave 11 (E31 to E34). Declared ahead of their modules, as wave 10's were. Legal holds (permission
  // `legal`, module folder `holds`) are not an area: a hold must never lapse because a part was
  // switched off. Field names are the wave 11 inventory extension contract (C2).
  {
    key: 'continuity', label: 'Business continuity and emergency management', defaultOn: true,
    description: 'Business processes and their impact analyses, continuity and emergency plans with call trees, the gap report and emergency activations.',
    permissions: ['continuity'], modules: ['continuity'], jobs: ['continuity.'],
    lookupValues: { action_source: ['continuity'], notification_kind: ['continuity'] }, owns: { role: ['continuity_manager'] },
  },
  {
    key: 'condition', label: 'Asset condition and state of good repair', defaultOn: true,
    description: 'Asset classes and useful life, condition assessments of assets, vehicles and sites, and the state-of-good-repair dashboard and targets.',
    // Shares the assets, sites and fleet permissions: its record types and fields are hidden by name.
    permissions: [], types: ['asset_class', 'condition_assessment'], modules: ['condition'], jobs: ['condition.'],
    lookupValues: { action_source: ['condition'] },
    fields: {
      asset: ['asset_class_id', 'condition_rating', 'condition_assessed_on', 'useful_life_end', 'replacement_project_id', 'in_service_date'],
      vehicle: ['asset_class_id', 'condition_rating', 'condition_assessed_on', 'useful_life_end', 'replacement_project_id', 'odometer_miles', 'odometer_read_on'],
      site: ['asset_class_id', 'condition_rating', 'condition_assessed_on', 'useful_life_end', 'replacement_project_id', 'site_kind', 'built_year', 'in_use'],
    },
    lists: ['site_kind'],
  },
  {
    key: 'ot', label: 'OT and rail-systems security', defaultOn: true,
    description: 'Operational technology on systems and assets, security zones and conduits with their target and achieved levels.',
    // Shares the systems permissions: its record types and fields are hidden by name.
    permissions: [], types: ['ot_zone', 'ot_conduit'], modules: ['ot'], jobs: ['ot.'],
    lookupValues: { action_source: ['ot'] },
    fields: {
      system: ['ot_system', 'control_level', 'safety_related', 'vendor_remote_access', 'remote_access_path', 'patchability', 'field_location', 'zone_id'],
      asset: ['ot_asset', 'control_level', 'safety_related', 'firmware_version', 'zone_id'],
    },
    lists: ['ot_control_level', 'vendor_remote_access', 'ot_patchability'],
  },
  {
    key: 'records', label: 'Records requests and privacy', defaultOn: true,
    description: 'Requests for records and personal data with their deadlines, responsive records and exemptions, and privacy impact assessments. Legal holds stay on.',
    permissions: ['records', 'privacy'], modules: ['records'], jobs: ['records.'],
    lookupValues: { action_source: ['records', 'privacy'], notification_kind: ['records'] },
    fields: { data_category: ['personal_data', 'personal_data_kinds'] },
  },
  // Wave 13 (E37, E38). Asset tags have their own permission module (`tags`, module folder `tags`);
  // the Tag number field of vehicles, sites and systems is theirs. The asset's own `tag` field is the
  // asset's reference and stays. The mobile app has no permission module: it is the module folder
  // `mobile` (devices, My work, settings) and the OAuth client kind `mobile` (modules/mcp/oauth.ts),
  // which answers as unknown while the area is off.
  {
    key: 'tags', label: 'Asset tags', defaultOn: true,
    description: 'Tag numbers on assets, vehicles, sites and systems (printed digits, letters, barcodes or 2D codes), tag formats and stock, printing your own tags, finding a record by its tag, and inventory counts.',
    permissions: ['tags'], types: ['inventory_count'], modules: ['tags'], jobs: ['tags.'],
    fields: { vehicle: ['tag_number'], site: ['tag_number'], system: ['tag_number'] },
    lookupValues: { action_source: ['inventory_count'], asset_status: ['missing'], vehicle_status: ['missing'] },
  },
  {
    key: 'mobile', label: 'Mobile app', defaultOn: false,
    description: 'The Sandpiper GRC app for iPhone and Android: sign-in through the phone\'s browser, My work, reading asset tags with the camera, reporting problems with photos, inspections, condition assessments and counts that work offline, push notifications, and the list of signed-in devices. Switching it off signs out every device.',
    permissions: [], modules: ['mobile', 'push'], jobs: ['mobile.', 'push.'],
  },
  // Wave 20 (E41-02). Shares the systems permissions, like OT security: its record types are hidden by name.
  {
    key: 'accessreviews', label: 'User access reviews', defaultOn: true,
    description: 'The accounts each system holds, matched to the staff roster with leavers and people on leave flagged, and review campaigns in which system owners keep or remove each account, with removals tracked to done.',
    permissions: [], types: ['system_account', 'access_review'], modules: ['accessreviews'], jobs: ['accessreviews.'],
    lookupValues: { action_source: ['access_review'], notification_kind: ['access_review'] },
    lists: ['system_account_status', 'system_account_kind', 'system_account_attention', 'system_account_match', 'system_account_source', 'access_review_status'],
  },
  // Wave 22 (E41-15). Shares the records permissions (records requests), so its record types and lists are
  // hidden by name; switching records requests off takes those permissions away, and so hides it too.
  {
    key: 'recordsretention', label: 'Records retention schedule', defaultOn: true,
    description: 'The organization\'s own record series, paper and electronic, with how long each is kept after which event and what happens at the end, and a destruction log in which each batch of records is approved before it is destroyed and recorded with its certificate afterwards. Legal holds stop a destruction.',
    permissions: [], types: ['record_series', 'records_destruction'], modules: ['recordsretention'], jobs: ['recordsretention.'],
    lists: ['record_series_status', 'record_series_category', 'record_medium', 'retention_unit', 'retention_trigger', 'record_disposition', 'destruction_status', 'destruction_method'],
  },
];

export const AREA_KEYS = AREAS.map((a) => a.key);

/**
 * Areas added while the application runs (E41-06): each register an administrator defines is an area
 * of its own, switched under Administration > Features like the others. `defineRuntimeArea` adds or
 * replaces one in AREAS, `removeRuntimeArea` takes it out again; a built-in area is never touched.
 * Call `invalidateFeatures(db)` afterwards so the next read sees it. AREA_KEYS and FEATURE_DEFAULTS
 * keep the built-in areas only (a run-time area missing from the stored setting takes its default).
 */
const BUILT_IN_AREAS = new Set(AREA_KEYS);
export function defineRuntimeArea(area: Area): void {
  if (BUILT_IN_AREAS.has(area.key)) throw new Error(`Area ${area.key} is built in`);
  const i = AREAS.findIndex((a) => a.key === area.key);
  if (i >= 0) AREAS[i] = area; else AREAS.push(area);
}
export function removeRuntimeArea(key: string): void {
  if (BUILT_IN_AREAS.has(key)) return;
  const i = AREAS.findIndex((a) => a.key === key);
  if (i >= 0) AREAS.splice(i, 1);
}

/**
 * Options within an area (E18-28): one feature of a part of the application that suits some
 * transit organizations but not all (a publicly funded agency, a private operator, a contractor
 * running service for an agency). An option is on unless an administrator switches it off, so an
 * upgrade changes nothing, and it may carry a name the installation can change ("Board resolution",
 * "Approval reference") where the idea is general but the word is not.
 *
 * While an option is off its fields disappear from the record type everywhere fields are listed
 * (forms, lists, record pages, filters, exports, imports, the report builder, the API description
 * and MCP tools; values written to them are ignored and stored values are kept), and the module
 * stops applying its rule. A renamed option relabels its fields the same way. Modules read the
 * state with `optionOn(state, key)` and `optionName(state, key)`; the web reads the fields from
 * `/api/meta`. Stored in the `feature_options` setting: `{ <option>: { on?: boolean, name?: string } }`.
 */
export interface AreaOption {
  key: string;
  /** The area it belongs to, or null for a part that is always on (inventory). */
  area: string | null;
  /** Where it is shown when `area` is null. */
  group?: string;
  label: string;
  description: string;
  defaultOn: boolean;
  /** Fields hidden while the option is off, by record type. */
  fields: Record<string, string[]>;
  /** A name the installation may change, and the field labels that follow it (`{name}` is replaced). */
  name?: { default: string; hint: string; labels: Record<string, Record<string, string>> };
}

export const OPTIONS: AreaOption[] = [
  {
    key: 'funder_interest', area: null, group: 'Inventory', defaultOn: true,
    label: 'Outside funder interest in equipment',
    description: 'Records that an outside funder (for example a grant program or a public body that paid for part of the equipment) keeps an interest in an asset or vehicle, and refuses to dispose of such an asset until the reference of the funder\'s approval is entered. Switch it off if nobody outside your organization keeps an interest in what you own.',
    fields: { asset: ['funder_interest', 'funder_interest_pct'], vehicle: ['funder_interest', 'funder_interest_pct'] },
    name: {
      default: 'Funder interest', hint: 'For example "Grant interest" or "Lender interest".',
      labels: {
        asset: { funder_interest: '{name}', funder_interest_pct: '{name} (%)' },
        vehicle: { funder_interest: '{name}', funder_interest_pct: '{name} (%)' },
      },
    },
  },
  {
    key: 'contract_approval_number', area: 'vendors', defaultOn: true,
    label: 'Approval number on contracts',
    description: 'A field on each contract for the number of the decision that approved it (a board resolution, a purchase approval or a delegated-authority reference). Switch it off if your contracts are not approved that way.',
    fields: { contract: ['resolution_number'] },
    name: {
      default: 'Approval or resolution number', hint: 'For example "Board resolution" or "Approval reference".',
      labels: { contract: { resolution_number: '{name}' } },
    },
  },
  {
    key: 'ransom_approval', area: 'secincidents', defaultOn: true,
    label: 'Recorded approval of a ransom payment',
    description: 'A ransom payment cannot be marked approved on a security incident until the reference of the approval is recorded (for example a governing body resolution or the owners\' written decision). Switch it off only if your policy records that decision elsewhere.',
    fields: { security_incident: ['board_resolution_ref'] },
    name: {
      default: 'Payment approval reference', hint: 'For example "Board resolution" or "Approval reference".',
      labels: { security_incident: { board_resolution_ref: '{name}' } },
    },
  },
];

export const OPTION_KEYS = OPTIONS.map((o) => o.key);

export interface OptionState { on: boolean; name: string }

/** Longest name an option may be given. */
export const OPTION_NAME_MAX = 60;

/** The stored `feature_options` setting merged over the defaults (unknown keys and bad values dropped). */
export function effectiveOptions(stored: unknown): Record<string, OptionState> {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Row : {};
  return Object.fromEntries(OPTIONS.map((o) => {
    const v = s[o.key] && typeof s[o.key] === 'object' ? s[o.key] as Row : {};
    const name = typeof v.name === 'string' && v.name.trim() && o.name ? v.name.trim().slice(0, OPTION_NAME_MAX) : o.name?.default ?? '';
    return [o.key, { on: typeof v.on === 'boolean' ? v.on : o.defaultOn, name }];
  }));
}

/** Field labels of one record type under the given option state (only fields an option renames or hides). */
export function optionFields(options: Record<string, OptionState>, type: string): { hidden: Set<string>; labels: Record<string, string> } {
  const hidden = new Set<string>();
  const labels: Record<string, string> = {};
  for (const o of OPTIONS) {
    const st = options[o.key] ?? { on: o.defaultOn, name: o.name?.default ?? '' };
    if (!st.on) for (const f of o.fields[type] ?? []) hidden.add(f);
    for (const [f, tpl] of Object.entries(o.name?.labels[type] ?? {})) labels[f] = tpl.replace('{name}', st.name);
  }
  return { hidden, labels };
}

/** The defaults: every area on except the portal. */
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(AREAS.map((a) => [a.key, a.defaultOn]));

/** The stored setting merged over the defaults (unknown keys dropped). */
export function effectiveFeatures(stored: unknown): Record<string, boolean> {
  const s = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Row : {};
  return Object.fromEntries(AREAS.map((a) => [a.key, typeof s[a.key] === 'boolean' ? s[a.key] as boolean : a.defaultOn]));
}

/** A message for each area that is on while an area it needs is off; empty when consistent. */
export function dependencyProblems(on: Record<string, boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of AREAS) {
    if (!on[a.key]) continue;
    const missing = (a.requires ?? []).filter((r) => !on[r]);
    if (missing.length) {
      const names = missing.map((m) => AREAS.find((x) => x.key === m)!.label.toLowerCase()).join(' and ');
      out[a.key] = `${a.label} needs ${names}. Switch ${missing.length > 1 ? 'them' : 'it'} on first, or switch ${a.label.toLowerCase()} off too.`;
    }
  }
  return out;
}

/** Areas that need `key` (directly or not). */
export function dependents(key: string): string[] {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const a of AREAS) if (a.requires?.includes(k) && !out.has(a.key)) { out.add(a.key); walk(a.key); }
  };
  walk(key);
  return [...out];
}

export interface FeatureState {
  on: Record<string, boolean>;
  /** Switched-off areas. */
  off: Area[];
  /** Permission modules nobody holds. */
  offPermissions: Set<string>;
  /** Record types hidden besides those of an off permission module. */
  offTypes: Set<string>;
  /** Server module folders whose routes answer 404. */
  offModules: Set<string>;
  offJobs: string[];
  /** Values of shared lists that are hidden, by list. */
  offLookupValues: Map<string, Set<string>>;
  /** Fields hidden by area (besides those referring to a switched-off type), by record type. */
  offFields: Map<string, Set<string>>;
  /** Rows of shared set-up that belong to an off area (`owns`), by kind. */
  offOwned: Map<string, Set<string>>;
  /** Options within areas (E18-28): whether each is on and its name. */
  options: Record<string, OptionState>;
}

function collect(maps: Record<string, string[]>[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of maps) for (const [k, vs] of Object.entries(m)) out.set(k, new Set([...(out.get(k) ?? []), ...vs]));
  return out;
}

/** The values of a list without those of switched-off areas (E14-34). */
export function visibleValues<T extends { value: string }>(state: FeatureState, list: string, values: T[]): T[] {
  const off = state.offLookupValues.get(list);
  return off ? values.filter((v) => !off.has(v.value)) : values;
}

export function stateFrom(on: Record<string, boolean>, options: Record<string, OptionState> = effectiveOptions(null)): FeatureState {
  const off = AREAS.filter((a) => !on[a.key]);
  return {
    on, off, options,
    offPermissions: new Set(off.flatMap((a) => a.permissions)),
    offTypes: new Set(off.flatMap((a) => a.types ?? [])),
    offModules: new Set(off.flatMap((a) => a.modules)),
    offJobs: off.flatMap((a) => a.jobs),
    offLookupValues: collect(off.map((a) => a.lookupValues ?? {})),
    offFields: collect(off.map((a) => a.fields ?? {})),
    offOwned: collect(off.map((a) => a.owns ?? {})),
  };
}

const ALL_ON = stateFrom(effectiveFeatures({}));

/** How long one process trusts what it read; a change made in this process applies at once. */
const TTL_MS = 5_000;
const cache = new WeakMap<object, { state: FeatureState; at: number; loading?: Promise<FeatureState> }>();

/** The current switches for this database (cached for a few seconds). */
export async function featureState(db: Queryable): Promise<FeatureState> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
  if (hit?.loading && !inTrial()) return hit.loading;
  const loading = (async () => {
    let stored: unknown = null;
    let storedOptions: unknown = null;
    try {
      for (const r of await db.query<{ key: string; value: unknown }>(`select key, value from settings where key in ('features', 'feature_options')`)) {
        if (r.key === 'features') stored = r.value; else storedOptions = r.value;
      }
    } catch { /* settings table not created yet (very first start) */ }
    const state = stateFrom(effectiveFeatures(stored), effectiveOptions(storedOptions));
    cache.set(db, { state, at: Date.now() });
    return state;
  })();
  cache.set(db, { state: hit?.state ?? ALL_ON, at: hit?.at ?? 0, loading });
  return loading;
}

/** The last state read for this database, without waiting (everything on before the first read). */
export function knownFeatureState(db: object): FeatureState {
  return cache.get(db)?.state ?? ALL_ON;
}

/** Forget the cached state (called when the `features` setting is written). */
export function invalidateFeatures(db: object): void {
  cache.delete(db);
}

/** Whether a permission belongs to a switched-off area. */
export const permissionOff = (state: FeatureState, perm: string) => state.offPermissions.has(perm.split('.')[0]);

/** Whether a record type belongs to a switched-off area. */
export const typeOff = (state: FeatureState, def: ResourceDef) => state.offPermissions.has(def.module) || state.offTypes.has(def.type);

/** Whether a row of shared set-up (`owns`: a default role, a risk scale) belongs to a switched-off area. */
export const ownedOff = (state: FeatureState, kind: string, key: string | null | undefined): boolean =>
  Boolean(key && state.offOwned.get(kind)?.has(key));

/**
 * A list of roles to offer (a role picker, a role filter) without the default roles of switched-off
 * areas (E18-64). Stored choices that name one are kept; only what is offered and shown changes.
 */
export const rolesShown = <T extends { key: string }>(state: FeatureState, rows: T[]): T[] =>
  rows.filter((r) => !ownedOff(state, 'role', r.key));

/** Whether an option within an area is on (an option of a switched-off area counts as off). */
export function optionOn(state: FeatureState, key: string): boolean {
  const o = OPTIONS.find((x) => x.key === key);
  if (!o) return true;
  if (o.area && state.on[o.area] === false) return false;
  return state.options[key]?.on ?? o.defaultOn;
}

/** The name an installation gives an option (its default when not renamed). */
export const optionName = (state: FeatureState, key: string): string =>
  state.options[key]?.name || OPTIONS.find((x) => x.key === key)?.name?.default || key;

/** Whether background work of this job type belongs to a switched-off area. */
export const jobOff = (state: FeatureState, type: string) => state.offJobs.some((p) => type.startsWith(p));

export const SWITCHED_OFF = 'This part of the application is switched off. An administrator can switch it on under Administration > Features.';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The module folder that registered the route (set by the feature gate). */
    grcModule?: string;
  }
  interface FastifyInstance {
    /** Record types of switched-off areas (for records stored by key, such as notifications): E14-34. */
    switchedOffTypes(): string[];
    /**
     * First segments of the web addresses of switched-off record types ("training" for
     * /training/courses) that no record type still on uses: for links stored as text (E14-34).
     */
    switchedOffPaths(): string[];
  }
}

/**
 * The server side of the switches, installed by app.ts:
 *  - remembers which module registered each route (`during(key, fn)` around a module's register());
 *  - answers 404 `switched_off` for a route of a switched-off module, for a generated route of a
 *    switched-off record type, and for a core route asked about such a type (`:type`, `type`,
 *    `record_type`, `from_type`, `to_type`);
 *  - once the application is ready, hides switched-off record types from the resource registry
 *    (`get` answers undefined and `all` leaves them out), so every list of types (metadata, search,
 *    OpenAPI, report catalog, imports, webhooks, custom fields, MCP) and every module guard
 *    `ctx.resources.get(type)` treat them as not installed. Core's own engine is unaffected.
 */
export function makeFeatureGate(app: FastifyInstance, db: Queryable) {
  let current: string | undefined;
  let registry: ResourceRegistry | null = null;
  let baseGet: ResourceRegistry['get'] = () => undefined;
  let baseAll: ResourceRegistry['all'] = () => [];
  let active = false;
  const routeModules = new Map<string, string>();

  if (!app.hasDecorator('switchedOffTypes')) {
    app.decorate('switchedOffTypes', () => (active ? baseAll().filter((d) => typeOff(known(), d)).map((d) => d.type) : []));
  }
  if (!app.hasDecorator('switchedOffPaths')) {
    app.decorate('switchedOffPaths', () => {
      if (!active) return [];
      const s = known();
      const first = (route?: string) => /^\/([^/?#]+)/.exec(route ?? '')?.[1];
      const on = new Set(baseAll().filter((d) => !typeOff(s, d)).map((d) => first(d.route)));
      return [...new Set(baseAll().filter((d) => typeOff(s, d)).map((d) => first(d.route)))].filter((p): p is string => Boolean(p) && !on.has(p));
    });
  }

  app.addHook('onRoute', (r) => {
    if (!current || !r.url?.startsWith('/api/')) return;
    routeModules.set(r.url, current);
    r.config = { ...(r.config ?? {}), grcModule: current } as typeof r.config;
  });

  const known = () => knownFeatureState(db);
  const isTypeOffIn = (s: FeatureState, type: string) => {
    const def = baseGet(type);
    return Boolean(def && typeOff(s, def));
  };
  const isTypeOff = (type: unknown) => {
    if (typeof type !== 'string') return false;
    const def = baseGet(type);
    return Boolean(def && typeOff(known(), def));
  };

  /** Whether a route is switched off (also used to cut the OpenAPI document down). */
  function routeOff(url: string, module?: string): boolean {
    const s = known();
    if (!s.off.length) return false;
    if (module && s.offModules.has(module)) return true;
    return baseAll().some((d) => typeOff(s, d) && (url === d.path || url.startsWith(`${d.path}/`)));
  }

  /**
   * Options within areas: the fields of an option that is off are taken out of their record type's
   * definition, and a renamed option relabels its fields, so every place that lists fields follows.
   * The same goes for the fields of a type that stays on that refer to a switched-off type (a
   * system's vendor and contract) or that an area lists as its own (E14-34): stored values are kept.
   * The module's own field list is kept and the fields are rebuilt from it whenever the state changes.
   */
  const original = new Map<ResourceDef, Record<string, FieldDef>>();
  let appliedFor: FeatureState | null = null;
  function applyOptions(s: FeatureState) {
    if (!active || s === appliedFor) return;
    appliedFor = s;
    for (const def of baseAll()) {
      const fields = original.get(def) ?? def.fields;
      const refsOff = Object.entries(fields).some(([, f]) => f.type === 'ref' && f.to && isTypeOffIn(s, f.to));
      if (!original.has(def) && !refsOff && !s.offFields.has(def.type) && !OPTIONS.some((o) => o.fields[def.type] || o.name?.labels[def.type])) continue;
      original.set(def, fields);
      const { hidden, labels } = optionFields(s.options, def.type);
      for (const f of s.offFields.get(def.type) ?? []) hidden.add(f);
      for (const [name, f] of Object.entries(fields)) if (f.type === 'ref' && f.to && isTypeOffIn(s, f.to)) hidden.add(name);
      def.fields = Object.fromEntries(Object.entries(fields)
        .filter(([name]) => !hidden.has(name))
        .map(([name, f]) => [name, labels[name] && labels[name] !== f.label ? { ...f, label: labels[name] } : f]));
    }
  }

  app.addHook('preHandler', async (req: FastifyRequest) => {
    // By path or by matched route, so no spelling of the path can step around the switch (wave 9).
    const api = isApiRequest(req);
    if (!api && !req.url.startsWith('/mcp')) return;
    const s = await featureState(db);
    applyOptions(s);
    if (!api) return;
    if (!s.off.length) return;
    const module = req.routeOptions?.config?.grcModule;
    const url = routePattern(req);
    if (routeOff(url, module)) fail(404, 'switched_off', SWITCHED_OFF);
    if (module) return; // a module's own route reads its parameters its own way
    const p = (req.params ?? {}) as Row;
    const q = (req.query ?? {}) as Row;
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Row;
    for (const t of [p.type, q.type, q.record_type, b.record_type, b.from_type, b.to_type]) {
      if (isTypeOff(t)) fail(404, 'switched_off', SWITCHED_OFF);
    }
  });

  return {
    /** Runs a module's register() with its routes marked as belonging to it. */
    async during<T>(module: string, fn: () => Promise<T> | T): Promise<T> {
      current = module;
      try { return await fn(); } finally { current = undefined; }
    },
    /** Hides switched-off record types from the registry, from the moment the application is ready. */
    attach(reg: ResourceRegistry) {
      registry = reg;
      baseGet = reg.get.bind(reg);
      baseAll = reg.all.bind(reg);
      reg.get = (type) => {
        const def = baseGet(type);
        return def && active && typeOff(known(), def) ? undefined : def;
      };
      reg.all = () => (active ? baseAll().filter((d) => !typeOff(known(), d)) : baseAll());
    },
    /** Start hiding (after every module has registered, so registration sees every type). */
    activate() {
      active = Boolean(registry);
      void featureState(db).then(applyOptions, () => {});
    },
    /** Applies the options within areas to the record types now (also done before every API request). */
    async applyOptions() { applyOptions(await featureState(db)); },
    routeOff,
    /**
     * Whether a configurable list belongs to a switched-off area (E14-34): its owning permission
     * module is off, it is named in an off area's `lists`, or every field that offers it is on an off
     * record type or is a field an off area hides.
     */
    listOff(list: string, owner: string | null | undefined): boolean {
      const s = known();
      if (!s.off.length) return false;
      if (owner && s.offPermissions.has(owner)) return true;
      if (s.off.some((a) => a.lists?.includes(list))) return true;
      // Every field that offers it is on a switched-off type, or is a field an off area hides
      // (asset condition's rating on assets, vehicles and sites).
      const uses = baseAll().flatMap((d) => Object.entries(original.get(d) ?? d.fields)
        .filter(([, f]) => f.type === 'lookup' && f.list === list).map(([name]) => ({ d, name })));
      return uses.length > 0 && uses.every(({ d, name }) => typeOff(s, d) || Boolean(s.offFields.get(d.type)?.has(name)));
    },
    /** The module folder that registered a route url, if a module did. */
    moduleOf: (url: string) => routeModules.get(url),
    state: () => featureState(db),
    known,
  };
}

export type FeatureGate = ReturnType<typeof makeFeatureGate>;
