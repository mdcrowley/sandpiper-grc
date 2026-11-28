// Plan templates (wave 26): built-in starting points for a new continuity or emergency plan. Each is
// invented, generic and jurisdiction-neutral: it names no law, regulator, agency, place or supplier.
// Starting a plan from a template fills its scope, activation criteria and recovery strategies, its
// other sections (`body`, headings with prompts to replace) and a starter checklist by phase. The
// organization then edits every word; nothing ties the plan to the template afterward except
// `template_key`, kept for the record.
import type { PHASES } from './plans.ts';

export interface PlanTemplate {
  key: string;
  label: string;
  description: string;
  plan_type: string;
  review_months: number;
  scope: string;
  activation_criteria: string;
  recovery_strategies: string;
  /** The other sections, as Markdown headings with prompts in square brackets. */
  body: string;
  checklist: [phase: (typeof PHASES)[number], item: string, role: string][];
}

const MAINTENANCE = `## Plan maintenance and exercising
- Owner: [the person who keeps this plan current].
- Review: at least every twelve months, and after every activation, exercise, reorganization or major system change.
- Exercises: [a tabletop exercise each year and a practical test of the call tree twice a year]; record each exercise on the plan's Exercises tab.
- Distribution: [who holds a copy, including an offline or printed copy].`;

const RETURN = `## Return to normal
- [Who decides that normal operations can resume, and on what conditions.]
- [How work done on workarounds is entered back into the normal systems.]
- Hold a debrief within [two weeks] and record the after-action summary and corrective actions.`;

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'business_continuity',
    label: 'Business continuity plan',
    description: 'Keeps the vital and essential business processes running, or brings them back within their tolerable downtime, after any disruption.',
    plan_type: 'continuity',
    review_months: 12,
    scope: '[The business processes, departments and sites this plan covers.] Processes are listed on the Processes tab with their tolerable downtime and recovery time objectives.',
    activation_criteria: 'A vital or essential process is down, or is expected to be down, for longer than half its maximum tolerable downtime; or the continuity lead or a member of senior management declares an activation.',
    recovery_strategies: 'Switch affected processes to their manual workarounds first. Restore supporting systems and facilities in order of process criticality. Move staff to an alternate site or remote work when a site is lost.',
    body: `## Purpose
[Why this plan exists and what it protects: riders, staff, service and the organization's obligations.]

## Roles and responsibilities
- Continuity lead: declares and stands down the activation, keeps the log.
- Process owners: run the workarounds for their processes and report status.
- IT recovery lead: restores systems in the agreed order.
- Communications lead: informs staff, riders and partners.
- [Deputies for each role.]

## Communications and call tree
The call tree is kept on the plan's Call tree tab. [Add how staff, riders, partners and the media are informed, and the fallback when phones or email are down.]

## Recovery priorities and objectives
| Priority | Process | Recovery time objective | Recovery point objective |
|---|---|---|---|
| 1 | [Process] | [hours] | [hours of data] |
| 2 | [Process] | [hours] | [hours of data] |

## Alternate sites and resources
- Alternate work site: [site, capacity, how to get access].
- Equipment and supplies: [laptops, radios, printed forms, keys].
- Key suppliers and their emergency contacts: [supplier, contact].

${RETURN}

${MAINTENANCE}`,
    checklist: [
      ['activate', 'Confirm which processes are affected and how long the disruption may last', 'Continuity lead'],
      ['activate', 'Declare the activation and start the call tree', 'Continuity lead'],
      ['activate', 'Open the activation log', 'Continuity lead'],
      ['respond', 'Switch affected processes to their manual workarounds', 'Process owners'],
      ['respond', 'Tell staff, riders and partners what is affected and what to do', 'Communications lead'],
      ['recover', 'Restore systems and facilities in order of process criticality', 'IT recovery lead'],
      ['recover', 'Enter work done on workarounds back into the normal systems', 'Process owners'],
      ['stand_down', 'Confirm every process is back to normal and stand down', 'Continuity lead'],
      ['stand_down', 'Hold the debrief and record the after-action summary', 'Continuity lead'],
    ],
  },
  {
    key: 'disaster_recovery',
    label: 'Disaster recovery plan',
    description: 'Restores the information systems and data the business processes depend on, in tiers, after the loss of a system, a server room or a data center.',
    plan_type: 'it_disaster_recovery',
    review_months: 12,
    scope: '[The systems, data and infrastructure this plan restores, and the locations they run in.] Link the business processes they support on the Processes tab.',
    activation_criteria: 'Loss of the main server room or data center; loss of a tier 1 system for longer than its recovery time objective; or data corruption or a cyberattack that needs restoring from backups.',
    recovery_strategies: 'Restore the network, identity and directory services first, then tier 1 systems, then tier 2 and tier 3. Each system is checked with its owner before it is handed back.',
    body: `## Systems in scope
| System | Tier | Owner | Recovery time objective | Recovery point objective |
|---|---|---|---|---|
| [Network and directory] | 0 | [owner] | [hours] | [hours] |
| [System] | 1 | [owner] | [hours] | [hours] |

## Recovery tiers
- Tier 0: infrastructure every other system needs (network, identity, backups).
- Tier 1: systems behind vital processes, restored first.
- Tier 2: systems behind essential processes.
- Tier 3: everything else, restored when time allows.

## Roles and responsibilities
- IT recovery lead: declares the disaster, decides the order of work, reports to the continuity lead.
- Infrastructure engineers: network, servers, storage and backups.
- System owners: check data and function before a system is handed back.
- Service desk: tells users what is available.

## Backup and restore procedures
- Backups: [what is backed up, how often, where copies are kept, and the offline or immutable copy].
- Restore: [where the restore procedure for each system is kept and who may run it].
- Credentials: [where the break-glass accounts and keys are kept].

## Failover steps
1. [Confirm the primary site or system is lost and record the time.]
2. [Bring up the standby site or restore to replacement hardware.]
3. [Restore tier 0, then tier 1 systems; check each with its owner.]
4. [Redirect users and interfaces to the recovered systems.]

## Testing
- Restore test of each tier 1 system at least [every six months]; record it as an exercise on the plan's Exercises tab.
- Full failover test [once a year].

${RETURN}

${MAINTENANCE}`,
    checklist: [
      ['activate', 'Declare the disaster and tell the service desk and the continuity lead', 'IT recovery lead'],
      ['activate', 'Secure the backups and stop any process that could overwrite good data', 'Infrastructure engineer'],
      ['respond', 'Restore the network and identity services', 'Infrastructure engineer'],
      ['recover', 'Restore tier 1 systems and check each with its owner', 'IT recovery lead'],
      ['recover', 'Restore tier 2 and tier 3 systems', 'IT recovery lead'],
      ['stand_down', 'Confirm data with each system owner and hand the systems back', 'IT recovery lead'],
      ['stand_down', 'Record what was lost, the time to recover and lessons learned', 'IT recovery lead'],
    ],
  },
  {
    key: 'emergency_operations',
    label: 'Emergency operations plan',
    description: 'How the organization responds to an emergency that affects service, staff or riders: severe weather, power loss, a major accident or a security threat.',
    plan_type: 'emergency_operations',
    review_months: 12,
    scope: '[The emergencies this plan covers and the service, facilities and staff it applies to.] Hazard-specific annexes (for example severe weather) can be separate plans linked to this one.',
    activation_criteria: 'A warning or event that threatens the safety of riders or staff, or stops a significant part of service; or a request for help from emergency services or a partner organization.',
    recovery_strategies: 'Protect people first, then vehicles and facilities. Run a reduced or diverted service announced to riders. Restore service line by line after inspection.',
    body: `## Purpose
[What this plan is for and who uses it.]

## Levels of activation
- Monitoring: [conditions and who watches].
- Partial: [conditions; who joins the emergency operations room].
- Full: [conditions; all roles staffed].

## Roles and responsibilities
- Emergency manager: leads the response and the emergency operations room.
- Operations lead: service changes, vehicles and crews.
- Safety lead: the safety of riders and staff, and liaison with emergency services.
- Communications lead: riders, staff, partners and the media.
- Facilities lead: buildings, power and access.

## Communications and call tree
The call tree is kept on the plan's Call tree tab. [Add the radio channels, the backup means of communication and the outside contacts: emergency services, utilities and mutual-aid partners.]

## Emergency operations room
- Primary location: [site]. Alternate: [site].
- [What is kept there: maps, radios, printed plans, contact lists.]

## Resources
- [Vehicles available for evacuation or bus bridges.]
- [Generators, radios, signage and other equipment, and where they are kept.]

${RETURN}

${MAINTENANCE}`,
    checklist: [
      ['activate', 'Open the emergency operations room and start the log', 'Emergency manager'],
      ['activate', 'Start the call tree and brief control and the depots', 'Emergency manager'],
      ['respond', 'Make riders and staff safe; contact emergency services where needed', 'Safety lead'],
      ['respond', 'Change or suspend service and announce it to riders', 'Operations lead'],
      ['respond', 'Post updates for riders and staff at agreed times', 'Communications lead'],
      ['recover', 'Inspect routes, stops and facilities before service resumes', 'Facilities lead'],
      ['stand_down', 'Stand down and tell everyone on the call tree', 'Emergency manager'],
      ['stand_down', 'Debrief and record the after-action summary and corrective actions', 'Emergency manager'],
    ],
  },
  {
    key: 'loss_of_facility',
    label: 'Loss of a facility',
    description: 'What to do when a depot, the operations control center or an office cannot be used: fire, flood, power loss or no access.',
    plan_type: 'continuity',
    review_months: 12,
    scope: '[The facilities this plan covers, for example each depot, the operations control center and the head office, and the work done in each.]',
    activation_criteria: 'A facility cannot be used, or cannot be reached, for longer than [four hours], or the facility manager or emergency services order it closed.',
    recovery_strategies: 'Move the work to the named alternate site, run it from vehicles or remotely where possible, and recover the facility in stages once it is declared safe.',
    body: `## Facilities and their alternates
| Facility | Work done there | Alternate site | Time to move |
|---|---|---|---|
| [Depot] | [Bus storage, maintenance, dispatch] | [Other depot or yard] | [hours] |
| [Operations control center] | [Control and dispatch] | [Backup control room] | [hours] |

## Roles and responsibilities
- Facility manager: closes and secures the facility, liaises with emergency services and the owner.
- Continuity lead: declares the activation and coordinates the move.
- Operations lead: moves vehicles and crews and adjusts service.
- IT recovery lead: networks, phones and systems at the alternate site.

## Moving to the alternate site
1. [Account for everyone who was in the facility.]
2. [Move vehicles, keys and essential equipment if it is safe.]
3. [Open the alternate site and set up phones, radios and systems.]
4. [Tell staff where to report.]

## Communications and call tree
The call tree is kept on the plan's Call tree tab. [Add the building owner, utilities and the alarm company.]

${RETURN}

${MAINTENANCE}`,
    checklist: [
      ['activate', 'Account for everyone and secure the facility', 'Facility manager'],
      ['activate', 'Declare the activation and start the call tree', 'Continuity lead'],
      ['respond', 'Open the alternate site and tell staff where to report', 'Continuity lead'],
      ['respond', 'Move vehicles and crews and adjust service', 'Operations lead'],
      ['respond', 'Set up networks, phones and radios at the alternate site', 'IT recovery lead'],
      ['recover', 'Inspect the facility and agree when it is safe to return', 'Facility manager'],
      ['stand_down', 'Move back and stand down', 'Continuity lead'],
      ['stand_down', 'Debrief and record the after-action summary', 'Continuity lead'],
    ],
  },
];

export const templateOf = (key: unknown): PlanTemplate | undefined => PLAN_TEMPLATES.find((t) => t.key === key);
