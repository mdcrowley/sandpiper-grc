import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the training module's hand-written routes (server/src/modules/training). */

const TRAINING = 'Training';
const COURSES = 'Courses';
const EXERCISES = 'Exercises';
const VALIDATION = '400 `validation` with the fields at fault.';
const SIGNED_IN = 'Needs only a signed-in person: it reads or writes the caller\'s own records.';
const ON_COURSE = 'The course must be visible to the caller (404 `not_found` otherwise).';
const ON_EXERCISE = 'The exercise must be visible to the caller (404 `not_found` otherwise).';

/** One training record as the record queries return it (person and course joined in). */
const RECORD = `{ id: uuid, course_id: uuid, user_id: uuid | null, person_key: string, assigned_on: date | null, due_on: date | null,
  completed_on: date | null, attempted_on: date | null, score: number | null, result: string | null, evidence_note: string | null,
  source: string, self_certified: boolean, course_title: string, course_ref: string, mandatory: boolean, recurrence_months: integer | null,
  self_certify: boolean, course_status: string, person: string, email: string | null, department: string | null, has_account: boolean,
  status: 'complete' | 'not_passed' | 'due' | 'overdue', created_at: datetime }`;

const RULE = `{ id: uuid, course_id: uuid, audience_type: 'everyone' | 'role' | 'department' | 'user', role_id: uuid | null,
  department_id: uuid | null, user_id: uuid | null, created_at: datetime, audience_label: string, people: integer "Active accounts it covers." }`;

const TALLY = 'total: integer, complete: integer, due: integer, overdue: integer, rate: integer | null "Percentage complete."';

const COMPLETION = `completed_on?: date | null, score?: number | null "0 to 100.", result?: string | null "A value or label of the training_result list.",
  evidence_note?: string | null, assigned_on?: date | null, due_on?: date | null`;

const PARTICIPANT = '{ id: uuid, name: string, role: string | null, attended: boolean }';
const ACTION_STATE = '{ id: uuid, ref: string, title: string, status: string, status_label: string, status_color: string, due_on: date | null }';
const FINDING = `{ id: uuid, finding: string, severity: string | null, recommendation: string | null, action_id: uuid | null, action: ${ACTION_STATE} | null }`;
const STEP = `{ id: uuid, phase: string | null, phase_label: string | null, step: string, sort: number, outcome: string | null, notes: string | null,
  source_scenario: string | null }`;
const STEP_ROW = '{ id: uuid, exercise_id: uuid, phase: string | null, step: string, sort: number, outcome: string | null, notes: string | null, source_scenario: string | null, ... }';
const CAL_ENTRY = `{ id: uuid, ref: string, title: string, type: string | null, type_label: string, owner_name: string | null, facilitator: string | null,
  kind: 'planned' | 'repeat', date: date | null, last_run: date | null }`;

export const DOCS: RouteDoc[] = [
  // ---------- assignment rules and audiences ----------
  route('GET', '/api/training/audiences', 'Roles, departments and department names a course can be assigned to', {
    tag: TRAINING, permission: 'training.view',
    response: '{ roles: [{ id: uuid, name: string }], departments: [{ id: uuid, name: string }], department_names: [string] "Departments seen on training records." }',
  }),
  route('GET', '/api/courses/:id/assignments', 'Assignment rules of a course', {
    tag: COURSES, permission: 'training.view', description: ON_COURSE, response: `[${RULE}]`,
  }),
  route('POST', '/api/courses/:id/assignments', 'Assign a course to everyone, a role, a department or a person', {
    tag: COURSES, permission: 'training.edit',
    description: `${ON_COURSE} Raises training records for the people it covers at once and tells them. Audited. ${VALIDATION} 409 \`duplicate\` when the course is already assigned to that audience.`,
    body: `{ audience_type: 'everyone' | 'role' | 'department' | 'user', role_id?: uuid "With role.", department_id?: uuid "With department.",
      user_id?: uuid "With user." }`,
    response: `{ ${RULE.slice(1, -1)}, records_created: integer }`, status: 201,
  }),
  route('DELETE', '/api/courses/:id/assignments/:ruleId', 'Remove an assignment rule from a course', {
    tag: COURSES, permission: 'training.edit',
    description: `${ON_COURSE} Records already raised are kept. Audited.`, response: '{ ok: boolean }',
  }),
  route('POST', '/api/training/sync', 'Apply the assignment rules now', {
    tag: TRAINING, permission: 'training.edit',
    description: 'Raises records for people newly covered by a rule and renewals for completions older than the course\'s repeat period. The server also does this daily.',
    response: '{ created: integer, renewed: integer }',
  }),

  // ---------- reading records ----------
  route('GET', '/api/courses/:id/progress', 'Who has completed a course, and who is due or overdue', {
    tag: COURSES, permission: 'training.view',
    description: `${ON_COURSE} One row per person: their open record, otherwise their latest completion.`,
    response: `{ today: date, ${TALLY}, people: [${RECORD}] }`,
  }),
  route('GET', '/api/training/records', 'Search training records', {
    tag: TRAINING, permission: 'training.view',
    description: 'One record per person per course unless `scope=all`; at most 2,000 rows. 400 `bad_filter` for a filter that is not valid.',
    query: {
      course_id: q('uuid', 'Only this course.'),
      department: 'Department name; `none` for people with no department.',
      status: 'complete, due or overdue; comma separated.',
      q: 'Part of the person\'s name or email, or of the course title or reference.',
      scope: '`all` for every record (default: the latest per person per course).',
      active: '`true` for active courses only.',
      overdue_at: q('date', 'Records that were overdue on that day (implies scope=all).'),
    },
    response: `{ today: date, rows: [${RECORD}], total: integer }`,
  }),
  route('GET', '/api/training/summary', 'Completion across active courses, by course and department, with a twelve-month overdue trend', {
    tag: TRAINING, permission: 'training.view',
    response: `{ today: date, totals: { people: integer, courses: integer, ${TALLY} },
      by_course: [{ course_id: uuid, ref: string, title: string, mandatory: boolean, recurrence_months: integer | null, ${TALLY} }],
      by_department: [{ department: string | null, label: string, ${TALLY} }],
      overdue: [${RECORD}], trend: [{ month: string "YYYY-MM.", as_of: date, overdue: integer }] }`,
  }),

  // ---------- my training ----------
  route('GET', '/api/training/mine', 'Your own training records', {
    tag: TRAINING, description: SIGNED_IN, response: `{ today: date, rows: [${RECORD}] }`,
  }),
  route('GET', '/api/training/mine/self-certify', 'Courses you may mark complete yourself', {
    tag: TRAINING, description: SIGNED_IN,
    response: '[{ id: uuid, ref: string, title: string, description: string | null, duration_minutes: number | null }]',
  }),
  route('POST', '/api/training/mine/complete', 'Record your own completion of a self-certified course', {
    tag: TRAINING,
    description: `${SIGNED_IN} The course must allow it (403 \`not_self_certified\` otherwise). Audited. ${VALIDATION} 409 \`duplicate\` when already recorded for that day.`,
    body: '{ course_id: uuid, evidence_note: string "How it was completed; up to 2,000 characters.", completed_on?: date "Default today; not in the future." }',
    response: RECORD, status: 201,
  }),

  // ---------- writing records ----------
  route('POST', '/api/training/records', 'Record training completed by, or assign it to, up to 500 people', {
    tag: TRAINING, permission: 'training.create',
    description: `With \`completed_on\` each person's training is recorded as completed (a result that does not pass is recorded as an attempt and the training stays due); without it the course is assigned to them. A person is an account (\`user_id\`) or a name and email; an email that matches an account becomes that account. Audited. ${VALIDATION}`,
    body: `{ course_id: uuid, people: [{ user_id?: uuid, name?: string, email?: email, department?: string }], ${COMPLETION} }`,
    response: `{ created: integer, completed: integer, assigned: integer, attempted: integer, duplicate: integer, exists: integer, skipped: integer,
      rows: [{ id: uuid, person: string, outcome: 'created' | 'completed' | 'assigned' | 'duplicate' | 'exists' | 'attempted' }] }`,
    status: 201,
  }),
  route('PATCH', '/api/training/records/:id', 'Change a training record', {
    tag: TRAINING, permission: 'training.edit',
    description: `Only members sent are changed. A completion with a result that does not pass becomes an attempt and the training stays due. Audited. ${VALIDATION}`,
    body: `{ ${COMPLETION} }`, response: RECORD,
  }),
  route('DELETE', '/api/training/records/:id', 'Remove a training record', {
    tag: TRAINING, permission: 'training.delete', description: 'Audited.', response: '{ ok: boolean }',
  }),
  route('POST', '/api/training/import', 'Import training completions from CSV text, with a dry run', {
    tag: TRAINING, permission: 'training.create',
    description: 'Every row is checked first; rows with errors are never written and duplicates (same person, course and completion date as an existing record or an earlier row) are skipped. Dry run by default. At most 5,000 rows. 400 `validation` for an empty or oversized file, 400 `mapping` for a column mapping at fault. A real run is audited and applies the assignment rules.',
    body: `{ csv: string, mapping: { [field]: string "CSV column header. Fields: course, person_email, person_name, person_department, completed_on, score, result, evidence_note." },
      course_id?: uuid "The course for every row when no column is mapped to course.", dryRun?: boolean "Default true.", delimiter?: string "One character; default a comma." }`,
    response: `{ dryRun: boolean, total: integer, valid: integer, errors: integer, duplicates: integer, created: integer, updated: integer, skipped: integer,
      wouldCreate?: integer "Dry run only.",
      rows: [{ line: integer, data: object, errors: { [field]: string }, duplicate: { of: 'file' | 'existing', line?: integer } | null,
        action: 'create' | 'skip' | 'error', id?: uuid, outcome?: string }] }`,
  }),

  // ---------- settings ----------
  route('GET', '/api/training/settings', 'Training settings: how often overdue reminders are sent', {
    tag: TRAINING, permission: 'training.view', response: '{ reminder_interval_days: integer }',
  }),
  route('PUT', '/api/training/settings', 'Change how often overdue reminders are sent', {
    tag: TRAINING, permission: 'training.administer', description: VALIDATION,
    body: '{ reminder_interval_days: integer "1 to 90." }', response: '{ reminder_interval_days: integer }',
  }),

  // ---------- exercises: calendar ----------
  route('GET', '/api/exercises/calendar', 'Exercises coming up and overdue, and when each type was last run', {
    tag: EXERCISES, permission: 'exercises.view',
    description: 'An entry is a planned exercise (by its date) or the next run of a completed one (by its next due date) unless a later exercise of the same type is on record. Canceled exercises are left out.',
    response: `{ today: date, overdue: [${CAL_ENTRY}], upcoming: [${CAL_ENTRY}], undated: [${CAL_ENTRY}],
      by_type: [{ type: string, label: string, color: string, completed: integer, last_run: date | null, last_id: uuid | null, last_result: string | null,
        next_due: date | null, next_id: uuid | null, overdue: boolean }] }`,
  }),

  // ---------- exercises: participants ----------
  route('GET', '/api/exercises/:id/participants', 'Participants of an exercise', {
    tag: EXERCISES, permission: 'exercises.view', description: ON_EXERCISE, response: `[${PARTICIPANT}]`,
  }),
  route('POST', '/api/exercises/:id/participants', 'Add one participant, or several (one name a line)', {
    tag: EXERCISES, permission: 'exercises.edit',
    description: `${ON_EXERCISE} With \`names\` every line becomes a participant with the same role and attendance, and the answer is a list. Audited. ${VALIDATION}`,
    body: '{ name?: string "One participant.", names?: string "Several, one a line.", role?: string | null, attended?: boolean "Default true." }',
    response: `${PARTICIPANT} | [${PARTICIPANT}]`, status: 201,
  }),
  route('PATCH', '/api/exercises/:id/participants/:childId', 'Change a participant', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited. ${VALIDATION}`,
    body: '{ name?: string, role?: string | null, attended?: boolean }', response: PARTICIPANT,
  }),
  route('DELETE', '/api/exercises/:id/participants/:childId', 'Remove a participant', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited.`, response: '{ ok: boolean }',
  }),

  // ---------- exercises: findings ----------
  route('GET', '/api/exercises/:id/findings', 'Findings of an exercise with the state of their follow-up actions', {
    tag: EXERCISES, permission: 'exercises.view',
    description: `${ON_EXERCISE} \`action\` is null unless the action tracker is switched on and the caller may see the action.`,
    response: `{ actions_available: boolean, findings: [${FINDING}] }`,
  }),
  route('POST', '/api/exercises/:id/findings', 'Record a finding on an exercise', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited. ${VALIDATION}`,
    body: '{ finding: string, severity?: string | null "A value of the exercise_finding_severity list.", recommendation?: string | null }',
    response: FINDING, status: 201,
  }),
  route('PATCH', '/api/exercises/:id/findings/:childId', 'Change a finding', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited. ${VALIDATION}`,
    body: '{ finding?: string, severity?: string | null, recommendation?: string | null }', response: FINDING,
  }),
  route('DELETE', '/api/exercises/:id/findings/:childId', 'Remove a finding', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited.`, response: '{ ok: boolean }',
  }),
  route('POST', '/api/exercises/:id/findings/:childId/action', 'Raise the follow-up action for a finding', {
    tag: EXERCISES, permission: 'exercises.edit',
    description: `${ON_EXERCISE} Also needs \`actions.create\` (403 \`forbidden\`). One action per finding (409 \`exists\`); 409 \`actions_unavailable\` when the action tracker is not switched on. Title, owner and priority default from the finding and exercise. Audited.`,
    body: '{ title?: string, owner_id?: uuid, due_on?: date, priority?: string }',
    response: '{ finding_id: uuid, action: { id: uuid, ref: string, title: string, status: string, due_on: date | null } }', status: 201,
  }),

  // ---------- exercises: steps ----------
  route('GET', '/api/exercises/scenario-checklists', 'Incident scenario checklists an exercise can copy', {
    tag: EXERCISES, permission: 'exercises.view',
    description: '`available` is false when the security incidents module is not there.',
    response: '{ available: boolean, scenarios: [{ value: string, label: string, steps: integer }] }',
  }),
  route('GET', '/api/exercises/:id/steps', 'Steps of an exercise and how each went', {
    tag: EXERCISES, permission: 'exercises.view', description: ON_EXERCISE,
    response: `{ steps: [${STEP}], summary: { total: integer, went_well: integer, with_issues: integer, not_done: integer, not_tested: integer, unrecorded: integer } }`,
  }),
  route('POST', '/api/exercises/:id/steps/copy', 'Copy the checklist of an incident scenario onto an exercise', {
    tag: EXERCISES, permission: 'exercises.edit',
    description: `${ON_EXERCISE} 409 \`unavailable\` without the security incidents module; 409 \`already_copied\` when that scenario is already on the exercise. ${VALIDATION} Audited.`,
    body: '{ scenario: string "A value of the security_incident_scenario list." }',
    response: `{ copied: integer, steps: [${STEP}] }`, status: 201,
  }),
  route('POST', '/api/exercises/:id/steps', 'Add a step to an exercise by hand', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} The step goes last. Audited. ${VALIDATION}`,
    body: `{ step: string, phase?: string | null "A value of the incident_checklist_phase list.", outcome?: string | null "A value of the exercise_step_outcome list.",
      notes?: string | null }`,
    response: STEP_ROW, status: 201,
  }),
  route('PATCH', '/api/exercises/:id/steps/:stepId', 'Change a step or record how it went', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited. ${VALIDATION}`,
    body: '{ step?: string, phase?: string | null, outcome?: string | null, notes?: string | null }', response: STEP_ROW,
  }),
  route('DELETE', '/api/exercises/:id/steps/:stepId', 'Remove a step', {
    tag: EXERCISES, permission: 'exercises.edit', description: `${ON_EXERCISE} Audited.`, response: '{ ok: boolean }',
  }),
];
