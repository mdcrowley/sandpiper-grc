import type { LookupValue, ModuleContext } from '../../core/module.ts';

// Default configuration for security incidents. Everything here lands in tables that an
// administrator can edit; rows are added once (matched on `key`) and never overwritten.

export const LOOKUPS: Record<string, LookupValue[]> = {
  security_incident_severity: [
    { value: 'critical', label: 'Critical', color: 'red', sort: 10, meta: { level: 1, guide: 'Service to customers or safety is affected, or regulated data is confirmed exposed.' } },
    { value: 'high', label: 'High', color: 'orange', sort: 20, meta: { level: 2, guide: 'A core system or regulated data is at real risk; spread is possible.' } },
    { value: 'moderate', label: 'Moderate', color: 'amber', sort: 30, meta: { level: 3, guide: 'Limited to a few accounts or devices and contained quickly.' } },
    { value: 'low', label: 'Low', color: 'blue', sort: 40, meta: { level: 4, guide: 'Attempt or near miss with no confirmed impact.' } },
  ],
  // The lifecycle is data: `meta.stage` says what reaching a status means (see STAGES below).
  // An administrator can rename, reorder, add and retire statuses on the rules screen.
  security_incident_status: [
    { value: 'reported', label: 'Reported', color: 'gray', sort: 10, meta: { stage: 'reported' } },
    { value: 'declared', label: 'Declared', color: 'red', sort: 20, meta: { stage: 'declared' } },
    { value: 'contained', label: 'Contained', color: 'amber', sort: 30, meta: { stage: 'contained' } },
    { value: 'recovering', label: 'Recovering', color: 'blue', sort: 40, meta: { stage: 'contained' } },
    { value: 'closed', label: 'Closed', color: 'green', sort: 50, meta: { stage: 'closed' } },
  ],
  // Post-incident review. `meta.stage`: open (work in progress), completed, not_required.
  incident_review_status: [
    { value: 'not_started', label: 'Not started', color: 'gray', sort: 10, meta: { stage: 'open' } },
    { value: 'scheduled', label: 'Scheduled', color: 'blue', sort: 20, meta: { stage: 'open' } },
    { value: 'drafted', label: 'Findings drafted', color: 'amber', sort: 30, meta: { stage: 'open' } },
    { value: 'completed', label: 'Completed', color: 'green', sort: 40, meta: { stage: 'completed' } },
    { value: 'not_required', label: 'Not required', color: 'gray', sort: 50, meta: { stage: 'not_required' } },
  ],
  security_incident_scenario: [
    { value: 'ransomware', label: 'Ransomware', color: 'red', sort: 10 },
    { value: 'account_compromise', label: 'Account compromise', color: 'orange', sort: 20 },
    { value: 'payment_fraud', label: 'Payment fraud', color: 'amber', sort: 30 },
    { value: 'vendor_compromise', label: 'Vendor compromise', color: 'purple', sort: 40 },
    { value: 'lost_device', label: 'Lost device', color: 'blue', sort: 50 },
    // Transit operations scenarios.
    { value: 'dispatch_outage', label: 'Dispatch or CAD/AVL outage', color: 'red', sort: 52 },
    { value: 'fare_system_compromise', label: 'Fare system compromise', color: 'orange', sort: 54 },
    { value: 'onboard_network_compromise', label: 'Onboard network compromise', color: 'purple', sort: 56 },
    { value: 'other', label: 'Other', color: 'gray', sort: 60 },
  ],
  ransom_payment_status: [
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', sort: 10 },
    { value: 'under_consideration', label: 'Under consideration', color: 'amber', sort: 20 },
    { value: 'approved', label: 'Approved by the governing body', color: 'red', sort: 30 },
    { value: 'refused', label: 'Refused', color: 'green', sort: 40 },
  ],
  notification_task_status: [
    { value: 'pending', label: 'Pending', color: 'amber', sort: 10 },
    { value: 'done', label: 'Done', color: 'green', sort: 20 },
    { value: 'not_required', label: 'Not required', color: 'gray', sort: 30 },
  ],
  notification_trigger: [
    { value: 'any', label: 'Any incident', sort: 10 },
    { value: 'is_cyber_incident', label: 'Any cybersecurity or ransomware incident', sort: 20 },
    { value: 'personal_info_involved', label: 'Personal information involved', sort: 50 },
  ],
  // Kinds of data an incident may involve, beyond personal information. Each value becomes a
  // yes/no question when an incident is declared and can trigger notification rules
  // (trigger "kind:<value>"). Only neutral starters ship here: kinds that only some
  // organisations hold belong in the organisation profile (`lookups.incident_data_kind`)
  // or are added by an administrator under Administration > Lists.
  incident_data_kind: [
    { value: 'financial_data', label: 'Financial or payment information', sort: 10, meta: { hint: 'Bank, payment or account details of the organisation or of other people.' } },
    { value: 'confidential_business', label: 'Confidential business information', sort: 20, meta: { hint: 'Contracts, plans, credentials or anything else the organisation keeps confidential.' } },
    { value: 'rider_account_data', label: 'Rider account information', sort: 30, meta: { hint: 'Fare accounts, concession eligibility, journey history or contact details of riders.' } },
    { value: 'operational_data', label: 'Operational and safety information', sort: 40, meta: { hint: 'Vehicle locations, schedules, signalling or dispatch records, and safety reports.' } },
  ],
  incident_log_kind: [
    { value: 'note', label: 'Note', color: 'gray', sort: 10 },
    { value: 'action', label: 'Action taken', color: 'blue', sort: 20 },
    { value: 'decision', label: 'Decision', color: 'purple', sort: 30 },
    { value: 'communication', label: 'Communication', color: 'teal', sort: 40 },
    { value: 'system', label: 'System', color: 'gray', sort: 50 },
  ],
  incident_checklist_phase: [
    { value: 'containment', label: 'Containment', color: 'amber', sort: 10 },
    { value: 'recovery', label: 'Recovery', color: 'blue', sort: 20 },
  ],
};

/**
 * What a lifecycle status means, in order. Reaching "declared" (or anything later) stamps the
 * declaration time and starts the clocks; "contained" stamps containment; "closed" stamps closure.
 */
export const STAGES = ['reported', 'declared', 'contained', 'closed'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  reported: 'Before declaration: no clocks run',
  declared: 'Declared: clocks run',
  contained: 'Contained: spread has stopped',
  closed: 'Closed',
};
export const REVIEW_STAGES = ['open', 'completed', 'not_required'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export interface StagedValue<S extends string> { value: string; label: string; color: string; sort: number; stage: S }

/**
 * The values of a list with the stage each stands for. A value without a (valid) stage, such as
 * one added under Administration > Lists, takes the stage of the value before it in the list.
 */
function staged<S extends string>(values: LookupValue[], stages: readonly S[]): StagedValue<S>[] {
  let last = stages[0];
  return values.map((v) => {
    const s = v.meta?.stage;
    if (typeof s === 'string' && (stages as readonly string[]).includes(s)) last = s as S;
    return { value: v.value, label: v.label, color: v.color ?? 'gray', sort: v.sort ?? 0, stage: last };
  });
}

export async function lifecycle(ctx: ModuleContext): Promise<StagedValue<Stage>[]> {
  return staged(await ctx.lookups.values('security_incident_status'), STAGES);
}

export async function reviewLifecycle(ctx: ModuleContext): Promise<StagedValue<ReviewStage>[]> {
  return staged(await ctx.lookups.values('incident_review_status'), REVIEW_STAGES);
}

/** Built-in incident flags a notification rule can be triggered by ("any" always applies). */
export const FLAG_FIELDS = ['is_cyber_incident', 'personal_info_involved'] as const;

/** Lookup list of the configurable kinds of data; a rule is triggered by one with "kind:<value>". */
export const KIND_LIST = 'incident_data_kind';
export const KIND_PREFIX = 'kind:';

/**
 * Trigger names used before kinds of data became configurable. Profiles and databases that
 * still use them are mapped to a kind of data (see migrations/002_data_kinds.sql).
 */
export const LEGACY_TRIGGERS: Record<string, { value: string; label: string }> = {
  health_data_involved: { value: 'health_information', label: 'Health information' },
  card_data_involved: { value: 'payment_card_data', label: 'Payment card data' },
};

/** True when a rule's trigger applies to an incident (or to a set of answers shaped like one). */
export function triggerApplies(trigger: string, incident: Record<string, unknown>): boolean {
  if (trigger === 'any') return true;
  if (trigger.startsWith(KIND_PREFIX)) {
    return Array.isArray(incident.data_kinds) && incident.data_kinds.includes(trigger.slice(KIND_PREFIX.length));
  }
  return (FLAG_FIELDS as readonly string[]).includes(trigger) && incident[trigger] === true;
}

export interface IncidentQuestion { key: string; kind: 'flag' | 'data_kind'; value: string; question: string; hint: string; trigger: string; trigger_label: string }

const FLAG_QUESTIONS: Record<(typeof FLAG_FIELDS)[number], { question: string; hint: string }> = {
  is_cyber_incident: {
    question: 'Is this a cybersecurity or ransomware incident?',
    hint: 'Yes for any attack on, or unauthorised access to, the organisation\'s systems, accounts or data.',
  },
  personal_info_involved: {
    question: 'Could personal information be involved?',
    hint: 'Details of identifiable people, such as names with identity, licence or account numbers.',
  },
};

/** The yes/no questions asked when an incident is declared: the built-in flags, then one per kind of data. */
export async function incidentQuestions(ctx: ModuleContext): Promise<IncidentQuestion[]> {
  const triggers = await ctx.lookups.values('notification_trigger');
  const out: IncidentQuestion[] = FLAG_FIELDS.map((f) => ({
    key: f, kind: 'flag', value: f, ...FLAG_QUESTIONS[f], trigger: f,
    trigger_label: triggers.find((t) => t.value === f)?.label ?? f,
  }));
  for (const k of await ctx.lookups.values(KIND_LIST)) {
    out.push({
      key: `${KIND_PREFIX}${k.value}`, kind: 'data_kind', value: k.value,
      question: `Could ${k.label.charAt(0).toLowerCase()}${k.label.slice(1)} be involved?`,
      hint: typeof k.meta?.hint === 'string' ? k.meta.hint : '',
      trigger: `${KIND_PREFIX}${k.value}`, trigger_label: `${k.label} involved`,
    });
  }
  return out;
}

/** Every trigger a notification rule may use, with its label. */
export async function triggerOptions(ctx: ModuleContext): Promise<{ value: string; label: string }[]> {
  const any = (await ctx.lookups.values('notification_trigger')).find((t) => t.value === 'any');
  return [{ value: 'any', label: any?.label ?? 'Any incident' }, ...(await incidentQuestions(ctx)).map((q) => ({ value: q.trigger, label: q.trigger_label }))];
}

export interface RuleSeed {
  key: string; trigger: string; party: string; hours: number | null; required: boolean; active: boolean; guidance: string;
}

const SET_UP = 'Starter rule, switched off. Check whether this applies to your organisation, set the deadline (in hours from discovery) '
  + 'from the applicable law or contract, then switch the rule on.';

/**
 * Generic starter rules. Who must be told, and by when, depends on the organisation's
 * country, sector and contracts, so none of these carries a deadline and all are switched
 * off: every organisation must review them. An organisation's own rules are loaded from
 * its profile (`notificationRules`) by `loadOrganisationRules`.
 */
export const RULES: RuleSeed[] = [
  {
    key: 'national_cyber_agency', trigger: 'is_cyber_incident', party: 'National cyber security agency or CSIRT', hours: null, required: true, active: false,
    guidance: `${SET_UP} Record who took the report and any reference given.`,
  },
  {
    key: 'data_protection_regulator', trigger: 'personal_info_involved', party: 'Data protection or sector regulator', hours: null, required: true, active: false,
    guidance: SET_UP,
  },
  {
    key: 'data_sharing_partners', trigger: 'personal_info_involved', party: 'Partners whose data is held under an agreement', hours: null, required: true, active: false,
    guidance: `${SET_UP} Data sharing and processing agreements often set their own notice period.`,
  },
  {
    key: 'insurer', trigger: 'any', party: 'Cyber insurer', hours: null, required: true, active: false,
    guidance: `${SET_UP} The policy sets the notice period and may require the insurer's approval before an outside response firm is engaged.`,
  },
  {
    key: 'affected_individuals', trigger: 'personal_info_involved', party: 'Affected individuals', hours: null, required: true, active: false,
    guidance: `${SET_UP} Take legal advice on whether and how individuals must be told.`,
  },
  {
    key: 'transport_oversight', trigger: 'is_cyber_incident', party: 'Transport safety or oversight authority', hours: null, required: true, active: false,
    guidance: `${SET_UP} Some operators must report incidents that affect safety-critical or passenger-facing services; others are asked to report voluntarily.`,
  },
  {
    key: 'funding_partners', trigger: 'any', party: 'Funding agencies and partner operators', hours: null, required: false, active: false,
    guidance: `${SET_UP} Grant conditions and joint service agreements may ask to be told of incidents that disrupt service.`,
  },
];

/** Standing incident roles. Names and contact details are filled in by an administrator. */
export const CONTACTS: { key: string; role: string; notes: string }[] = [
  { key: 'incident_lead', role: 'Incident lead', notes: 'Runs the response, sets priorities and decides when the incident is contained and closed.' },
  { key: 'technical_lead', role: 'Technical lead', notes: 'Directs containment, investigation and recovery work.' },
  { key: 'communications', role: 'Communications', notes: 'Prepares and clears every message to staff, customers, media and partners.' },
  { key: 'scribe', role: 'Scribe', notes: 'Keeps the incident log: times, decisions, actions and who took them.' },
  { key: 'executive_sponsor', role: 'Executive sponsor', notes: 'Links the response team to the executive team and the governing body.' },
  { key: 'legal_counsel', role: 'Legal counsel', notes: 'Advises on notification duties, privilege and contracts.' },
  { key: 'insurer_contact', role: 'Cyber insurer contact', notes: 'First call for coverage and approved response firms.' },
  { key: 'operations_control', role: 'Operations control liaison', notes: 'Links the response team to the control centre: service impact, fallback working and safety decisions.' },
];

type Steps = { containment: string[]; recovery: string[] };

/** Original starter checklists; edit them under Notification rules and checklists. */
export const CHECKLISTS: Record<string, Steps> = {
  ransomware: {
    containment: [
      'Disconnect affected machines from the network (unplug or disable the switch port). Leave them powered on so memory can be examined',
      'Disable the accounts seen in use by the attacker and reset administrator and service account passwords',
      'Block the known malicious addresses, domains and file hashes at the firewall and endpoint protection',
      'Confirm that backups are intact and cut them off from the network until the spread has stopped',
      'Photograph or save the ransom note and note the file extension used. Do not contact the attacker',
      'Call the cyber insurer contact before engaging any outside response firm',
      'Tell staff what to stop using and where to report new symptoms',
    ],
    recovery: [
      'Find how the attacker got in and close that route before restoring anything',
      'Rebuild affected machines from clean images; do not clean them in place',
      'Restore data from the most recent backup verified to predate the attack',
      'Reset every password and sign-in token in the affected environment',
      'Bring services back in the agreed priority order and confirm each with its business owner',
      'Watch closely for re-infection for at least two weeks',
      'Record any ransom decision. Payment needs a recorded approval from the governing body',
    ],
  },
  account_compromise: {
    containment: [
      'Reset the password and sign the account out of every session',
      'Remove any sign-in methods, forwarding rules, delegates or app consents the attacker added',
      'Check sign-in history to find when and from where the account was misused',
      'Search for messages sent from the account and warn the people who received them',
      'Check whether the same password or sign-in approval was used on other accounts',
    ],
    recovery: [
      'Re-enrol the second sign-in factor with the account holder in person or by a known phone number',
      'List what the account could reach (mail, files, systems) and decide whether regulated data was exposed',
      'Return the account to its owner and confirm that normal work is possible',
      'Give the account holder a short refresher on how the compromise happened',
    ],
  },
  payment_fraud: {
    containment: [
      'Call the bank straight away to recall or freeze the payment and ask for the fraud team',
      'Stop any further payments or bank detail changes for the supplier or employee involved',
      'Keep the emails, invoices and call records exactly as received',
      'Check whether a mailbox or supplier account was compromised to make the request look real',
      'Tell the person responsible for finance and the cyber insurer contact',
    ],
    recovery: [
      'File a report with law enforcement and keep the report number for the bank and the insurer',
      'Confirm the true bank details with the supplier using a known phone number',
      'Review other recent bank detail changes and payments for the same pattern',
      'Reissue the legitimate payment once the details are verified',
      'Tighten the call-back check for bank detail changes and brief the staff who make payments',
    ],
  },
  vendor_compromise: {
    containment: [
      'Get the facts from the vendor in writing: what happened, when, and which of our data or connections are affected',
      'Suspend the vendor\'s remote access, interfaces and shared accounts until they confirm it is safe',
      'Change any passwords, keys or tokens the vendor holds for our systems',
      'Review activity from the vendor\'s accounts and connections for the period at risk',
      'Check the contract for the vendor\'s notification and support duties',
    ],
    recovery: [
      'Obtain the vendor\'s written statement of cause, scope and corrective action',
      'Decide with counsel whether our own notification duties are triggered by the vendor\'s incident',
      'Restore the vendor\'s access step by step with new credentials',
      'Update the vendor record and risk rating, and note any contract follow-up',
    ],
  },
  lost_device: {
    containment: [
      'Record when and where the device was last seen and who had it',
      'Lock the device remotely and, if it cannot be found quickly, wipe it',
      'Confirm whether the device was encrypted and protected by a passcode',
      'Reset the passwords of the accounts used on the device and end their sessions',
      'Report a theft to the police and keep the report number',
    ],
    recovery: [
      'List the data that was stored on or reachable from the device and decide whether regulated data was exposed',
      'Remove the device from device management and mark the asset record as lost or stolen',
      'Issue a replacement device set up from a clean image',
      'Check whether insurance or other reporting applies to the asset',
    ],
  },
  dispatch_outage: {
    containment: [
      'Tell the control centre to switch to the paper or radio fallback procedure for dispatch and vehicle tracking',
      'Confirm that voice radio and emergency alarms from vehicles still reach the control centre',
      'Decide whether the outage is a fault or an attack: look for unusual sign-ins, changed configuration or ransom notes',
      'If an attack is suspected, isolate the dispatch servers and their links to other networks; keep them powered on',
      'Stop data feeds from the dispatch system to rider information screens and apps if they may show wrong times',
      'Tell riders through the usual service-disruption channels that real-time information is unavailable',
      'Call the dispatch system supplier\'s support line and record the case reference',
    ],
    recovery: [
      'Restore the dispatch system from a backup verified to be clean, or rebuild it from the supplier\'s media',
      'Check vehicle location, schedule and assignment data against the paper records kept during the fallback',
      'Bring vehicles back onto the system in small groups and confirm each is reporting correctly',
      'Re-enable the rider information feeds only once times have been checked',
      'Reconcile any incidents, alarms or service changes logged on paper into the dispatch system',
      'Review how long the fallback procedure took to start and what was missing from it',
    ],
  },
  fare_system_compromise: {
    containment: [
      'Decide with operations whether to keep fare collection running, switch to a fallback, or suspend fares temporarily',
      'Isolate the affected fare servers, back office or ticket machines from the rest of the network',
      'Disable accounts and keys used by the attacker and any shared fare-system administrator accounts',
      'Ask the fare-system supplier and the payment processor to look for unusual transactions or refunds',
      'Stop any automatic top-ups, refunds or account changes that may be fraudulent',
      'Keep the fare system\'s logs and transaction records exactly as they are',
    ],
    recovery: [
      'Find how the attacker got in and close that route before reconnecting anything',
      'Reset every credential and key the fare system uses, including those shared with suppliers',
      'Reconcile fare revenue and rider account balances for the period at risk',
      'Decide with counsel whether rider account information was exposed and who must be told',
      'Restore fare collection in stages and check a sample of transactions at each stage',
      'Brief customer service on what to tell riders who ask about their accounts',
    ],
  },
  onboard_network_compromise: {
    containment: [
      'Identify which vehicles and which onboard systems are affected (wireless, cameras, displays, passenger counting, validators)',
      'Cut the link between the onboard network and the depot or central network for the affected vehicles',
      'Confirm with operations that the vehicles remain safe to run; safety systems take priority over everything else',
      'Switch off passenger wireless on the affected vehicles if it may be the route in',
      'Keep onboard recorders and camera footage; do not overwrite them',
      'Tell the onboard equipment supplier and record the case reference',
    ],
    recovery: [
      'Reload the affected onboard devices from known-good software at the depot',
      'Change the passwords and keys used by onboard devices and the depot wireless',
      'Check that each vehicle reconnects only to the expected central systems',
      'Separate passenger wireless from operational onboard systems if they were shared',
      'Add the affected devices to the vulnerability and asset records with what was found',
    ],
  },
};

/** Adds missing default rows. Safe at every start. */
export async function ensureDefaults(ctx: ModuleContext): Promise<void> {
  for (const [list, values] of Object.entries(LOOKUPS)) await ctx.lookups.ensure(list, values, { module: 'security' });

  for (const [i, r] of RULES.entries()) {
    await ctx.db.query(
      `insert into notification_rules (key, trigger_attribute, party, deadline_hours, required, guidance, active, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (key) do nothing`,
      [r.key, r.trigger, r.party, r.hours, r.required, r.guidance, r.active, (i + 1) * 10],
    );
  }
  for (const [i, c] of CONTACTS.entries()) {
    await ctx.db.query(
      `insert into incident_contacts (key, role, notes, sort) values ($1,$2,$3,$4) on conflict (key) do nothing`,
      [c.key, c.role, c.notes, (i + 1) * 10],
    );
  }
  for (const [scenario, phases] of Object.entries(CHECKLISTS)) {
    for (const phase of ['containment', 'recovery'] as const) {
      for (const [i, step] of phases[phase].entries()) {
        await ctx.db.query(
          `insert into incident_checklist_templates (key, scenario, phase, step, sort) values ($1,$2,$3,$4,$5)
           on conflict (key) do nothing`,
          [`${scenario}.${phase}.${i + 1}`, scenario, phase, step, (i + 1) * 10],
        );
      }
    }
  }
}

const MAX_DEADLINE_HOURS = 24 * 366;

/**
 * Loads the organisation's own notification rules (the `notificationRules` section of the
 * organisation profile): an array of `{ key, trigger, party, hours, required, active, guidance }`.
 * A rule is added when no rule with its key exists (removed ones included); an existing rule
 * is left exactly as it is, so an administrator's edits survive a repeat of the seed.
 * Returns the number of rules added.
 */
export async function loadOrganisationRules(ctx: ModuleContext, input: unknown): Promise<number> {
  if (input === undefined || input === null) return 0;
  if (!Array.isArray(input)) throw new Error('Organisation profile: notificationRules must be a list.');
  const kinds = new Set((await ctx.lookups.values(KIND_LIST)).map((k) => k.value));
  const fixed = ['any', ...FLAG_FIELDS] as string[];
  const describe = `any, ${FLAG_FIELDS.join(', ')} or ${KIND_PREFIX}<a value of the ${KIND_LIST} list>`;
  const newKinds = new Map<string, string>();

  const rules: RuleSeed[] = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const where = `Organisation profile: notificationRules[${i}]`;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const party = typeof r.party === 'string' ? r.party.trim() : '';
    if (!key) throw new Error(`${where} needs a key.`);
    if (!party) throw new Error(`${where} (${key}) needs a party.`);
    let trigger = typeof r.trigger === 'string' ? r.trigger : '';
    // Older profiles name a kind of data by its former built-in flag: the kind is added to the list.
    const legacy = LEGACY_TRIGGERS[trigger];
    if (legacy) {
      trigger = `${KIND_PREFIX}${legacy.value}`;
      if (!kinds.has(legacy.value)) newKinds.set(legacy.value, legacy.label);
    } else if (!fixed.includes(trigger) && !(trigger.startsWith(KIND_PREFIX) && kinds.has(trigger.slice(KIND_PREFIX.length)))) {
      throw new Error(`${where} (${key}): trigger must be ${describe}.`);
    }
    const hours = r.hours === undefined || r.hours === null ? null : Number(r.hours);
    if (hours !== null && !(hours >= 0 && hours <= MAX_DEADLINE_HOURS)) {
      throw new Error(`${where} (${key}): hours must be between 0 (immediately) and ${MAX_DEADLINE_HOURS}, or null.`);
    }
    const active = r.active === undefined ? hours !== null : r.active === true;
    if (active && hours === null) throw new Error(`${where} (${key}): an active rule needs a deadline in hours.`);
    return {
      key, party, trigger, hours, active,
      required: r.required !== false,
      guidance: typeof r.guidance === 'string' ? r.guidance : '',
    };
  });

  if (newKinds.size) {
    await ctx.lookups.ensure(KIND_LIST, [...newKinds].map(([value, label], i) => ({ value, label, sort: 100 + i * 10 })), { module: 'security' });
  }

  let added = 0;
  for (const r of rules) {
    const row = await ctx.db.one<{ id: string }>(
      `insert into notification_rules (key, trigger_attribute, party, deadline_hours, required, guidance, active, sort)
       values ($1,$2,$3,$4,$5,$6,$7, (select coalesce(max(sort), 0) + 10 from notification_rules))
       on conflict (key) do nothing returning id`,
      [r.key, r.trigger, r.party, r.hours, r.required, r.guidance, r.active],
    );
    if (!row) continue;
    added += 1;
    await ctx.audit(null, {
      action: 'notification_rule.create', recordType: 'notification_rule', recordId: row.id,
      summary: `Notification rule added from the organisation profile: ${r.party}`,
      after: { key: r.key, trigger_attribute: r.trigger, party: r.party, deadline_hours: r.hours, required: r.required, active: r.active },
    });
  }
  return added;
}
