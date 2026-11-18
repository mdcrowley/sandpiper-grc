/** Invented, sector-neutral sample data. Day numbers are offsets from the day the seed runs. */

export const SAMPLE_COURSES: {
  key: string; audience: string[]; title: string; description: string; category: string; provider: string; format: string;
  duration_minutes: number; recurrence_months?: number; due_days: number; mandatory: boolean;
}[] = [
  {
    key: 'awareness', audience: ['everyone'], title: '[Sample] Security awareness',
    description: 'The yearly course for all staff: passwords and sign-in codes, safe use of email and the web, reporting anything odd.',
    category: 'security_awareness', provider: 'In house', format: 'online', duration_minutes: 45, recurrence_months: 12, due_days: 30, mandatory: true,
  },
  {
    key: 'phishing', audience: ['everyone'], title: '[Sample] Spotting fake messages',
    description: 'A short refresher on fake emails, texts and calls, with examples and a quiz.',
    category: 'security_awareness', provider: 'In house', format: 'online', duration_minutes: 20, recurrence_months: 6, due_days: 21, mandatory: true,
  },
  {
    key: 'data', audience: ['everyone'], title: '[Sample] Handling personal and confidential data',
    description: 'How to store, share and dispose of personal and confidential information. Read the guide and confirm.',
    category: 'data_protection', provider: 'In house', format: 'document', duration_minutes: 30, recurrence_months: 24, due_days: 30, mandatory: true,
  },
  {
    key: 'incident', audience: ['agent', 'security_lead'], title: '[Sample] Incident response for IT staff',
    description: 'A workshop for the IT team: recognising an incident, first steps, keeping evidence, who to call and when.',
    category: 'technical', provider: 'External trainer', format: 'classroom', duration_minutes: 180, recurrence_months: 12, due_days: 60, mandatory: false,
  },
  {
    key: 'induction', audience: [], title: '[Sample] New-starter induction: IT and security',
    description: 'A briefing in the first two weeks: accounts, acceptable use, where to get help, how to report a problem.',
    category: 'induction', provider: 'In house', format: 'briefing', duration_minutes: 60, due_days: 14, mandatory: true,
  },
];

export const SAMPLE_PEOPLE: Record<string, { name: string; email: string; department: string }> = {
  a: { name: 'Rowan Ashby', email: 'rowan.ashby@example.test', department: 'Operations' },
  b: { name: 'Priya Calder', email: 'priya.calder@example.test', department: 'Operations' },
  c: { name: 'Tomas Lindqvist', email: 'tomas.lindqvist@example.test', department: 'Operations' },
  d: { name: 'Imani Brooks', email: 'imani.brooks@example.test', department: 'Operations' },
  e: { name: 'Hana Okafor', email: 'hana.okafor@example.test', department: 'Finance' },
  f: { name: 'Lewis Marchetti', email: 'lewis.marchetti@example.test', department: 'Finance' },
  g: { name: 'Sofia Renner', email: 'sofia.renner@example.test', department: 'Finance' },
  h: { name: 'Daniel Whitlow', email: 'daniel.whitlow@example.test', department: 'Customer service' },
  i: { name: 'Mei Tanaka', email: 'mei.tanaka@example.test', department: 'Customer service' },
  j: { name: 'Owen Farrell', email: 'owen.farrell@example.test', department: 'Customer service' },
  k: { name: 'Nadia Petrov', email: 'nadia.petrov@example.test', department: 'IT' },
  l: { name: 'Callum Reyes', email: 'callum.reyes@example.test', department: 'IT' },
  m: { name: 'Grace Adeyemi', email: 'grace.adeyemi@example.test', department: 'IT' },
  n: { name: 'Victor Halloran', email: 'victor.halloran@example.test', department: 'Facilities' },
};

export interface SampleRecord {
  course: string; person: string; assigned: number; due: number; completed?: number; score?: number;
  result?: string; source?: 'manual' | 'import'; note?: string;
}

const done = (course: string, person: string, completed: number, score: number | undefined, late = 0, allowed = 30): SampleRecord => ({
  course, person, assigned: completed - allowed + 8 - late, due: completed + 8 - late, completed, score,
  result: score === undefined ? 'attended' : 'passed', source: score === undefined ? 'manual' : 'import',
  note: score === undefined ? 'Signed attendance sheet' : 'Completion report from the learning platform',
});
const open = (course: string, person: string, due: number, allowed = 30): SampleRecord => ({ course, person, assigned: due - allowed, due });

/** 40 records: most completed, some still to do, some overdue; a few were completed late. */
export const SAMPLE_RECORDS: SampleRecord[] = [
  // Security awareness: everyone (14)
  done('awareness', 'a', -300, 92), done('awareness', 'b', -280, 88, 25), done('awareness', 'e', -250, 96),
  done('awareness', 'f', -230, 81, 40), done('awareness', 'h', -200, 90), done('awareness', 'k', -170, 100),
  done('awareness', 'l', -120, 94), done('awareness', 'm', -60, 85, 12), done('awareness', 'g', -25, 79),
  open('awareness', 'c', 18), open('awareness', 'i', 9),
  open('awareness', 'd', -15), open('awareness', 'j', -42), open('awareness', 'n', -75),
  // Spotting fake messages (10)
  done('phishing', 'a', -150, 90, 0, 21), done('phishing', 'e', -140, 75, 20, 21), done('phishing', 'h', -110, 85, 0, 21),
  done('phishing', 'k', -90, 100, 0, 21), done('phishing', 'l', -45, 95, 0, 21), done('phishing', 'g', -12, 80, 0, 21),
  open('phishing', 'b', 12, 21), open('phishing', 'm', 5, 21),
  open('phishing', 'j', -8, 21), open('phishing', 'n', -30, 21),
  // Handling personal and confidential data (8)
  done('data', 'e', -400, undefined), done('data', 'f', -380, undefined, 30), done('data', 'g', -310, undefined),
  done('data', 'h', -220, undefined), done('data', 'i', -90, undefined), done('data', 'k', -35, undefined),
  open('data', 'j', 22), open('data', 'c', -20),
  // Incident response for IT staff (3)
  done('incident', 'k', -160, undefined, 0, 60), done('incident', 'l', -160, undefined, 0, 60), open('incident', 'm', 40, 60),
  // New-starter induction (5)
  done('induction', 'g', -320, undefined, 0, 14), done('induction', 'i', -210, undefined, 0, 14), done('induction', 'm', -95, undefined, 5, 14),
  done('induction', 'c', -30, undefined, 0, 14), open('induction', 'n', -60, 14),
];

export const SAMPLE_EXERCISES: {
  title: string; type: string; status: string; date: number; next_due?: number; scenario: string; scope: string; facilitator: string;
  objectives: string; result?: string; outcome?: string;
  participants: { name: string; role: string; attended?: boolean }[];
  findings: { finding: string; severity: string; recommendation: string; action_title?: string; action_due?: number }[];
}[] = [
  {
    title: '[Sample] Tabletop: ransomware on the shared file server', type: 'tabletop', status: 'completed', date: -150, next_due: 215,
    scenario: 'On a Monday morning staff report that shared folders will not open and a ransom note is on screen. Backups exist but the last restore test was months ago.',
    scope: 'File server, backup service, staff workstations, the out-of-hours contact list.',
    facilitator: 'External facilitator',
    objectives: 'Walk through the first four hours.\nCheck that everyone knows who decides to isolate systems.\nCheck that contact details work without the network.',
    result: 'partly_met',
    outcome: 'The team isolated the server quickly on paper, but nobody could find the printed contact list and it was unclear who may approve taking systems offline.',
    participants: [
      { name: 'Nadia Petrov', role: 'IT lead' }, { name: 'Callum Reyes', role: 'Systems administrator' },
      { name: 'Hana Okafor', role: 'Finance manager' }, { name: 'Rowan Ashby', role: 'Operations manager' },
      { name: 'Daniel Whitlow', role: 'Customer service lead' }, { name: 'Victor Halloran', role: 'Facilities', attended: false },
    ],
    findings: [
      {
        finding: 'The printed out-of-hours contact list could not be found, and the copy on the network would not have been reachable.',
        severity: 'high', recommendation: 'Keep printed copies in two named places and review them every quarter.',
        action_title: 'Print and place the out-of-hours contact list', action_due: -90,
      },
      {
        finding: 'It was not clear who may approve taking the file server offline during working hours.',
        severity: 'medium', recommendation: 'Name a decision maker and a deputy in the incident response plan.',
        action_title: 'Name who approves taking systems offline', action_due: 20,
      },
      {
        finding: 'Staff outside IT did not know how to report a suspected incident by phone.',
        severity: 'low', recommendation: 'Add the phone number to the security awareness course and the induction briefing.',
      },
    ],
  },
  {
    title: '[Sample] Restore test: finance database', type: 'restore_test', status: 'completed', date: -200, next_due: -20,
    scenario: 'Restore last night\'s backup of the finance database to a spare server and have the finance team check a sample of records.',
    scope: 'Finance database, backup service, spare server.',
    facilitator: 'Callum Reyes',
    objectives: 'Restore within four hours.\nFinance confirms the data is complete to the previous evening.',
    result: 'met',
    outcome: 'Restored in two hours and forty minutes. Finance checked twenty records and found no gaps.',
    participants: [{ name: 'Callum Reyes', role: 'Systems administrator' }, { name: 'Sofia Renner', role: 'Finance officer' }],
    findings: [
      {
        finding: 'The restore steps were in one person\'s notes, not in the shared runbook.',
        severity: 'low', recommendation: 'Write the steps into the runbook and have a second person follow them next time.',
        action_title: 'Move the finance restore steps into the runbook', action_due: -120,
      },
    ],
  },
  {
    title: '[Sample] Restore test: shared file server', type: 'restore_test', status: 'planned', date: 21,
    scenario: 'Restore a full department folder from the previous week to a separate location and compare it with the original.',
    scope: 'File server, backup service.',
    facilitator: 'Grace Adeyemi',
    objectives: 'Restore one department folder within two hours.\nA second administrator follows the written runbook without help.',
    participants: [{ name: 'Grace Adeyemi', role: 'Systems administrator' }, { name: 'Callum Reyes', role: 'Observer' }],
    findings: [],
  },
  {
    title: '[Sample] Continuity test: working from the second site', type: 'continuity_test', status: 'completed', date: -400, next_due: -35,
    scenario: 'The main office cannot be used for a day. Customer service and finance work from the second site using spare laptops.',
    scope: 'Second site network, spare laptops, telephone diversion, remote access.',
    facilitator: 'Nadia Petrov',
    objectives: 'Ten staff working within two hours.\nPhones diverted within thirty minutes.\nPayments can be approved from the second site.',
    result: 'not_met',
    outcome: 'Phones were diverted in twenty minutes, but only six of ten spare laptops would sign in and payment approval needed a device left at the main office.',
    participants: [
      { name: 'Nadia Petrov', role: 'IT lead' }, { name: 'Daniel Whitlow', role: 'Customer service lead' },
      { name: 'Mei Tanaka', role: 'Customer service' }, { name: 'Lewis Marchetti', role: 'Finance officer' },
      { name: 'Victor Halloran', role: 'Facilities' },
    ],
    findings: [
      {
        finding: 'Four of ten spare laptops had not been switched on for months and could not sign in.',
        severity: 'high', recommendation: 'Start and update the spare laptops monthly, and record it.',
        action_title: 'Monthly check of the spare laptops', action_due: -300,
      },
      {
        finding: 'Payment approval depends on a device kept in the main office.',
        severity: 'high', recommendation: 'Hold a second approval device at the second site.',
        action_title: 'Second payment approval device at the second site', action_due: -10,
      },
      {
        finding: 'The second site has too few desks with network points for ten people.',
        severity: 'medium', recommendation: 'Agree which room is used and add network points or wireless cover.',
      },
    ],
  },
];
