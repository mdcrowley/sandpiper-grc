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
  security_incident_status: [
    { value: 'reported', label: 'Reported', color: 'gray', sort: 10 },
    { value: 'declared', label: 'Declared', color: 'red', sort: 20 },
    { value: 'contained', label: 'Contained', color: 'amber', sort: 30 },
    { value: 'recovering', label: 'Recovering', color: 'blue', sort: 40 },
    { value: 'closed', label: 'Closed', color: 'green', sort: 50 },
  ],
  security_incident_scenario: [
    { value: 'ransomware', label: 'Ransomware', color: 'red', sort: 10 },
    { value: 'account_compromise', label: 'Account compromise', color: 'orange', sort: 20 },
    { value: 'payment_fraud', label: 'Payment fraud', color: 'amber', sort: 30 },
    { value: 'vendor_compromise', label: 'Vendor compromise', color: 'purple', sort: 40 },
    { value: 'lost_device', label: 'Lost device', color: 'blue', sort: 50 },
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
    { value: 'health_data_involved', label: 'Health information involved', sort: 30 },
    { value: 'card_data_involved', label: 'Payment card data involved', sort: 40 },
    { value: 'personal_info_involved', label: 'Personal information involved', sort: 50 },
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

/** Incident flags a notification rule can be triggered by ("any" always applies). */
export const FLAG_FIELDS = ['is_cyber_incident', 'health_data_involved', 'card_data_involved', 'personal_info_involved'] as const;

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
    key: 'health_data_partner', trigger: 'health_data_involved', party: 'Health data partner or regulator', hours: null, required: true, active: false,
    guidance: `${SET_UP} Data sharing and processing agreements often set their own notice period.`,
  },
  {
    key: 'card_acquirer', trigger: 'card_data_involved', party: 'Card acquirer and card brands', hours: null, required: true, active: false,
    guidance: `${SET_UP} The acquirer agreement usually asks for notice straight away (0 hours).`,
  },
  {
    key: 'insurer', trigger: 'any', party: 'Cyber insurer', hours: null, required: true, active: false,
    guidance: `${SET_UP} The policy sets the notice period and may require the insurer's approval before an outside response firm is engaged.`,
  },
  {
    key: 'affected_individuals', trigger: 'personal_info_involved', party: 'Affected individuals', hours: null, required: true, active: false,
    guidance: `${SET_UP} Take legal advice on whether and how individuals must be told.`,
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
      'Tell Finance leadership and the cyber insurer contact',
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
      'Check whether insurance or funder reporting applies to the asset',
    ],
  },
};

/** Adds missing default rows. Safe at every start. */
export async function ensureDefaults(ctx: ModuleContext): Promise<void> {
  for (const [list, values] of Object.entries(LOOKUPS)) await ctx.lookups.ensure(list, values);

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
  const triggers = ['any', ...FLAG_FIELDS] as string[];

  const rules: RuleSeed[] = input.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const where = `Organisation profile: notificationRules[${i}]`;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    const party = typeof r.party === 'string' ? r.party.trim() : '';
    if (!key) throw new Error(`${where} needs a key.`);
    if (!party) throw new Error(`${where} (${key}) needs a party.`);
    if (typeof r.trigger !== 'string' || !triggers.includes(r.trigger)) {
      throw new Error(`${where} (${key}): trigger must be one of ${triggers.join(', ')}.`);
    }
    const hours = r.hours === undefined || r.hours === null ? null : Number(r.hours);
    if (hours !== null && !(hours >= 0 && hours <= MAX_DEADLINE_HOURS)) {
      throw new Error(`${where} (${key}): hours must be between 0 (immediately) and ${MAX_DEADLINE_HOURS}, or null.`);
    }
    const active = r.active === undefined ? hours !== null : r.active === true;
    if (active && hours === null) throw new Error(`${where} (${key}): an active rule needs a deadline in hours.`);
    return {
      key, party, trigger: r.trigger, hours, active,
      required: r.required !== false,
      guidance: typeof r.guidance === 'string' ? r.guidance : '',
    };
  });

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
