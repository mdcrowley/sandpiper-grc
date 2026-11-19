// Invented sample policies and exceptions for an invented transit operator. Every title starts with "[Sample]".

export interface SampleVersion {
  body: string;
  change_summary: string;
  /** How far the version gets: left as a draft, sent for review, approved, or published. */
  stage: 'draft' | 'in_review' | 'approved' | 'published';
  /** Days ago the version was approved and published (published stages only). */
  daysAgo?: number;
}

export interface SamplePolicy {
  key: string;
  title: string;
  summary: string;
  category: string;
  approver_name: string;
  approver_role: string;
  reviewInDays: number;
  audience: { everyone?: boolean; roles?: string[] };
  ack_days?: number;
  versions: SampleVersion[];
}

const ACCEPTABLE_USE_V1 = `## Purpose

This sample policy sets out how people may use the organization's computers, accounts and network.

## What we expect

- Use work accounts and equipment for work. Limited personal use is fine if it does not get in the way.
- Keep your password to yourself. Nobody in IT will ever ask for it.
- Lock your screen when you step away.
- Do not install software that IT has not agreed.

## Reporting

Tell the service desk straight away if you lose a device or think an account has been misused.
`;

const ACCEPTABLE_USE_V2 = `## Purpose

This sample policy sets out how people may use the organization's computers, accounts and network.

## What we expect

- Use work accounts and equipment for work. Limited personal use is fine if it does not get in the way.
- Keep your password to yourself. Nobody in IT will ever ask for it.
- Use the **second factor** wherever it is offered.
- Lock your screen when you step away.
- Do not install software that IT has not agreed.
- Do not paste confidential information into online tools the organization has not approved.

## Personal devices

A personal phone may be used for the second factor and for work email, provided it has a screen lock and is kept up to date.

## Reporting

Tell the service desk straight away if you lose a device or think an account has been misused. Reporting early is never held against you.
`;

export const SAMPLE_POLICIES: SamplePolicy[] = [
  {
    key: 'acceptable_use', title: '[Sample] Acceptable use policy', category: 'acceptable_use',
    summary: 'Invented example. How people may use the organization\'s computers, accounts and network.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: 200,
    audience: { everyone: true }, ack_days: 14,
    versions: [
      { body: ACCEPTABLE_USE_V1, change_summary: 'First issue.', stage: 'published', daysAgo: 400 },
      { body: ACCEPTABLE_USE_V2, change_summary: 'Adds the second factor, personal devices and online tools.', stage: 'published', daysAgo: 20 },
    ],
  },
  {
    key: 'access_control', title: '[Sample] Access control policy', category: 'access',
    summary: 'Invented example. Who is given access to systems, how it is approved and when it is removed.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: -12,
    audience: { roles: ['agent', 'security_lead'] }, ack_days: 21,
    versions: [{
      stage: 'published', daysAgo: 350, change_summary: 'First issue.',
      body: `## Principles

1. Access is given for a job, not for a person: it follows the role.
2. Each person has their own account. Shared accounts need a recorded exception.
3. Administrator rights are separate accounts, used only for administration.

## Joiners, movers and leavers

| Event | What happens | When |
|---|---|---|
| Someone joins | The manager requests access through the service desk | Before the first day |
| Someone changes role | Old access is removed as new access is added | Within five working days |
| Someone leaves | All accounts are disabled | On the last day |

## Review

System owners check who has access to their system twice a year and record the result.
`,
    }],
  },
  {
    key: 'backup', title: '[Sample] Backup and recovery policy', category: 'operations',
    summary: 'Invented example. What is backed up, how often, where copies are kept and how restores are tested.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: 365,
    audience: { roles: ['agent'] },
    versions: [{
      stage: 'approved', change_summary: 'First issue.',
      body: `## Scope

Every system in the inventory that holds information the organization could not easily recreate.

## Rules

- Take a backup at least **daily** for business systems and weekly for everything else.
- Keep one copy away from the main site and one copy that cannot be altered once written.
- Keep daily copies for 30 days and monthly copies for a year.
- Test a restore of each critical system at least once a year and record how long it took.

## Responsibilities

The system owner agrees how much data loss is tolerable. IT operations runs the backups and the tests.
`,
    }],
  },
  {
    key: 'incident_response', title: '[Sample] Incident response policy', category: 'incident',
    summary: 'Invented example. How suspected security incidents are reported, handled and reviewed.',
    approver_name: 'Sample Approver', approver_role: 'Chief Executive', reviewInDays: 365,
    audience: { everyone: true },
    versions: [{
      stage: 'in_review', change_summary: 'First draft for comment.',
      body: `## Report it

Anyone who suspects a security incident reports it to the service desk at once, by phone if email may be affected.

## Handle it

1. The security lead decides whether it is an incident and how serious it is.
2. An incident lead is named and keeps a timeline.
3. Affected systems are contained before they are cleaned up.
4. People outside the organization are told when the rules in force require it.

## Learn from it

Every incident ends with a short review: what happened, what worked, and the actions that follow.
`,
    }],
  },
  {
    key: 'remote_working', title: '[Sample] Remote working policy', category: 'acceptable_use',
    summary: 'Invented example. Working safely away from the organization\'s premises.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: 365,
    audience: { everyone: true },
    versions: [{
      stage: 'draft', change_summary: 'Working draft.',
      body: `## Before you work remotely

- Use a device issued or approved by IT, with disk encryption turned on.
- Connect through the organization's remote access service, not by forwarding files to personal accounts.

## While you work

- Do not let anyone else use your work device.
- Take care with screens and calls in public places.
- Avoid public wireless networks where you can; use your phone's hotspot instead.

> This draft has not been approved yet.
`,
    }],
  },
  {
    key: 'supplier_security', title: '[Sample] Supplier security policy', category: 'third_party',
    summary: 'Invented example. The security checks made before and while a supplier handles the organization\'s information.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: 25,
    audience: { roles: ['security_lead'] },
    versions: [{
      stage: 'published', daysAgo: 300, change_summary: 'First issue.',
      body: `## Before signing

- Record the supplier and how critical it is.
- Ask for current assurance evidence that matches the service being bought.
- Make sure the contract covers incident notification, return of data and the right to check.

## During the contract

- Review assurance evidence when it expires.
- Review critical suppliers every year.

## At the end

Confirm in writing that the organization's information has been returned or destroyed.
`,
    }],
  },
  {
    key: 'on_vehicle', title: '[Sample] On-vehicle systems security policy', category: 'operations',
    summary: 'Invented example. How the computers carried on buses and trains (ticket machines, passenger information, vehicle location) are kept secure.',
    approver_name: 'Sample Approver', approver_role: 'Head of IT', reviewInDays: 330,
    audience: { roles: ['agent'] },
    versions: [{
      stage: 'in_review', change_summary: 'First issue.',
      body: `## Scope

Every device fitted to a vehicle that runs software: ticket machines, passenger information displays, vehicle location units, on-board cameras and their recorders.

## Rules

1. Only devices recorded in the asset register are fitted. Each has an owner.
2. Software is updated in the depot, from a source checked by IT, never over a public connection.
3. Service ports on a device are covered or locked, and opened only by named staff.
4. A device that has been removed is wiped before it is reused, repaired or sold.

## When something looks wrong

Report a damaged seal, an unknown cable or a device behaving oddly to the service desk at once, and take the vehicle out of service if the driver's or passengers' safety could be affected.
`,
    }],
  },
];

export interface SampleException {
  title: string;
  policy: string;
  description: string;
  justification: string;
  compensating_controls: string;
  status: 'requested' | 'approved';
  approvedDaysAgo?: number;
  expiresInDays?: number;
}

export const SAMPLE_EXCEPTIONS: SampleException[] = [
  {
    title: '[Sample] Label printer cannot use the second factor', policy: 'access_control',
    description: 'Invented example. The label printing workstation signs in with a shared account and no second factor.',
    justification: 'The printing software only supports one local account. A replacement is planned.',
    compensating_controls: 'The workstation is on its own network segment, has no email or web access, and the account password is changed quarterly.',
    status: 'approved', approvedDaysAgo: 170, expiresInDays: 12,
  },
  {
    title: '[Sample] Archive server backed up weekly instead of daily', policy: 'backup',
    description: 'Invented example. A read-only archive is backed up once a week.',
    justification: 'The content changes a few times a year; daily copies would add cost without reducing loss.',
    compensating_controls: 'Any change to the archive triggers a manual backup the same day.',
    status: 'approved', approvedDaysAgo: 370, expiresInDays: -5,
  },
  {
    title: '[Sample] Contractor laptop without disk encryption', policy: 'remote_working',
    description: 'Invented example. A contractor asks to use their own laptop, which does not have disk encryption, for three months.',
    justification: 'Short engagement; issuing a device would take longer than the work.',
    compensating_controls: 'Access only through the remote desktop service; no files stored on the laptop.',
    status: 'requested', expiresInDays: 90,
  },
];

export const SAMPLE_PEOPLE: { username: string; name: string; department: string; role: string }[] = [
  { username: 'sample.avery', name: '[Sample] Avery Lindqvist', department: '[Sample] Operations', role: 'agent' },
  { username: 'sample.blake', name: '[Sample] Blake Okonkwo', department: '[Sample] Operations', role: 'agent' },
  { username: 'sample.casey', name: '[Sample] Casey Marchetti', department: '[Sample] Operations', role: 'agent' },
  { username: 'sample.devon', name: '[Sample] Devon Hartley', department: '[Sample] Finance', role: 'project_manager' },
  { username: 'sample.emery', name: '[Sample] Emery Voss', department: '[Sample] Finance', role: 'project_manager' },
  { username: 'sample.finley', name: '[Sample] Finley Arce', department: '[Sample] Finance', role: 'security_lead' },
];
