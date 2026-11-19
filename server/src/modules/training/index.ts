import type { ModuleDef, Row } from '../../core/module.ts';
import { defineExercise, registerExercises } from './exercises.ts';
import { registerExerciseSteps } from './exerciseSteps.ts';
import { registerImport } from './importer.ts';
import { notifyTraining, TRAINING_REMINDER_SETTING, trainingReminderInterval } from './notify.ts';
import { registerRecords } from './records.ts';
import { seedTraining } from './seed.ts';
import { registerSummary } from './summary.ts';
import { syncTrainingAssignments } from './sync.ts';

export { syncTrainingAssignments } from './sync.ts';
export { notifyTraining } from './notify.ts';

/**
 * Training and exercises: courses, who must take them, completion records and their
 * import, and tabletop exercises, restore tests and continuity tests with findings.
 */

const DAY = 24 * 60 * 60 * 1000;

const mod: ModuleDef = {
  key: 'training',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('course_category', [
      { value: 'security_awareness', label: 'Security awareness', color: 'blue', sort: 10 },
      { value: 'data_protection', label: 'Data protection', color: 'teal', sort: 20 },
      { value: 'technical', label: 'Technical', color: 'purple', sort: 30 },
      { value: 'induction', label: 'Induction', color: 'green', sort: 40 },
      { value: 'other', label: 'Other', color: 'gray', sort: 50 },
    ]);
    await ctx.lookups.ensure('course_format', [
      { value: 'online', label: 'Online', color: 'blue', sort: 10 },
      { value: 'classroom', label: 'Classroom', color: 'teal', sort: 20 },
      { value: 'briefing', label: 'Briefing', color: 'purple', sort: 30 },
      { value: 'document', label: 'Document to read', color: 'gray', sort: 40 },
    ]);
    await ctx.lookups.ensure('course_status', [
      { value: 'active', label: 'Active', color: 'green', sort: 10 },
      { value: 'retired', label: 'Retired', color: 'gray', sort: 20 },
    ]);
    await ctx.lookups.ensure('training_result', [
      { value: 'passed', label: 'Passed', color: 'green', sort: 10 },
      { value: 'attended', label: 'Attended', color: 'blue', sort: 20 },
      { value: 'failed', label: 'Did not pass', color: 'red', sort: 30 },
    ], { public: true }); // shown on "My training", which every signed-in user can open
    await ctx.lookups.ensure('exercise_type', [
      { value: 'tabletop', label: 'Tabletop exercise', color: 'blue', sort: 10 },
      { value: 'restore_test', label: 'Restore test', color: 'teal', sort: 20 },
      { value: 'continuity_test', label: 'Continuity test', color: 'purple', sort: 30 },
    ]);
    await ctx.lookups.ensure('exercise_status', [
      { value: 'planned', label: 'Planned', color: 'blue', sort: 10 },
      { value: 'completed', label: 'Completed', color: 'green', sort: 20 },
      { value: 'cancelled', label: 'Cancelled', color: 'gray', sort: 30 },
    ]);
    await ctx.lookups.ensure('exercise_result', [
      { value: 'met', label: 'Objectives met', color: 'green', sort: 10 },
      { value: 'partly_met', label: 'Partly met', color: 'amber', sort: 20 },
      { value: 'not_met', label: 'Not met', color: 'red', sort: 30 },
    ]);
    await ctx.lookups.ensure('exercise_finding_severity', [
      { value: 'high', label: 'High', color: 'red', sort: 10 },
      { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
      { value: 'low', label: 'Low', color: 'blue', sort: 30 },
    ], { module: 'exercises' });
    // How each step of an exercise went (steps copied from an incident scenario checklist).
    await ctx.lookups.ensure('exercise_step_outcome', [
      { value: 'went_well', label: 'Went well', color: 'green', sort: 10 },
      { value: 'with_issues', label: 'Done, with issues', color: 'amber', sort: 20 },
      { value: 'not_done', label: 'Not done', color: 'red', sort: 30 },
      { value: 'not_tested', label: 'Not tested', color: 'gray', sort: 40 },
    ], { module: 'exercises' });
  },

  async register(ctx) {
    function checkCourse(merged: Row) {
      const fields: Record<string, string> = {};
      const whole = (k: string, label: string, max: number) => {
        const v = merged[k];
        if (v !== null && v !== undefined && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > max)) {
          fields[k] = `${label} must be a whole number from 0 to ${max}.`;
        }
      };
      whole('recurrence_months', 'Repeat every (months)', 120);
      whole('due_days', 'Days allowed', 730);
      whole('duration_minutes', 'Duration (minutes)', 10000);
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    }

    ctx.defineResource({
      type: 'course', table: 'courses', module: 'training', label: 'Course', plural: 'Courses',
      path: '/api/courses', route: '/training/courses', titleField: 'title', ref: { field: 'ref', prefix: 'CRS-' },
      searchable: ['title', 'description', 'provider'],
      defaultSort: { field: 'title', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        description: { label: 'Description', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'course_category' },
        provider: { label: 'Provider', type: 'text' },
        format: { label: 'Format', type: 'lookup', list: 'course_format' },
        duration_minutes: { label: 'Duration (minutes)', type: 'number' },
        recurrence_months: { label: 'Repeat every (months)', type: 'number' },
        due_days: { label: 'Days allowed to complete', type: 'number', default: 30 },
        mandatory: { label: 'Mandatory', type: 'boolean', default: false },
        self_certify: { label: 'People may mark it complete themselves', type: 'boolean', default: false },
        owner_id: { label: 'Owner', type: 'user' },
        status: { label: 'Status', type: 'lookup', list: 'course_status', default: 'active' },
      },
      hooks: {
        beforeCreate: (_req, data) => { checkCourse(data); return data; },
        beforeUpdate: (_req, existing, patch) => { checkCourse({ ...existing, ...patch }); return patch; },
      },
    });
    defineExercise(ctx);

    registerRecords(ctx);
    registerSummary(ctx);
    registerImport(ctx);
    registerExercises(ctx);
    registerExerciseSteps(ctx);

    // ---------- settings: the overdue reminder interval ----------

    ctx.app.get('/api/training/settings', { preHandler: ctx.requirePerm('training.view') }, async () => ({
      reminder_interval_days: await trainingReminderInterval(ctx),
    }));
    ctx.app.put('/api/training/settings', { preHandler: ctx.requirePerm('training.administer') }, async (req) => {
      const raw = (req.body as Row | null)?.reminder_interval_days;
      const n = Number(raw);
      if (raw === null || raw === undefined || raw === '' || !Number.isInteger(n) || n < 1 || n > 90) {
        ctx.fail(400, 'validation', 'Check the highlighted fields.', { reminder_interval_days: 'Enter a whole number of days from 1 to 90.' });
      }
      if ((await trainingReminderInterval(ctx)) !== n) await ctx.settings.set(TRAINING_REMINDER_SETTING, n, req);
      return { reminder_interval_days: n };
    });

    // Assignment rules are applied at start and then daily, then people are told what is new or
    // overdue. The timer never keeps the process alive, and does not run under the test runner.
    const safeRun = async () => {
      try {
        await syncTrainingAssignments(ctx);
        await notifyTraining(ctx);
      } catch (err) {
        console.error('[training] assignment sync failed:', (err as Error).message);
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!process.env.VITEST && process.env.GRC_DATA_DIR !== 'memory') ctx.app.addHook('onReady', async () => {
      await safeRun();
      timer = setInterval(safeRun, DAY);
      timer.unref();
    });
    ctx.app.addHook('onClose', async () => {
      if (timer) clearInterval(timer);
    });
  },

  seed: seedTraining,
};

export default mod;
