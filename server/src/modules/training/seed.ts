import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { addDays, localDate } from './dates.ts';
import { createFindingAction } from './exercises.ts';
import { loadUsers, resolvePerson, saveTraining } from './people.ts';
import { SAMPLE_COURSES, SAMPLE_EXERCISES, SAMPLE_PEOPLE, SAMPLE_RECORDS } from './seed-sample.ts';
import { seedSampleQualifications } from './seed-qualifications.ts';
import { syncTrainingAssignments } from './sync.ts';

/**
 * Invented sample data, the same in both profiles and marked "[Sample]". Idempotent: the
 * training set is added only while no sample course exists, the exercises only while no
 * sample exercise exists, so later edits and deletions are never undone.
 */
export async function seedTraining(ctx: ModuleContext, _opts: SeedOptions, now: Date = new Date()): Promise<string> {
  const today = localDate(now);
  const day = (offset: number) => addDays(today, offset);
  const notes: string[] = [];

  if (await ctx.db.one(`select 1 from courses where title like '[Sample]%' limit 1`)) {
    notes.push('sample courses already present');
  } else {
    const users = await loadUsers(ctx);
    const courses = new Map<string, Row>();
    let rules = 0;
    for (const c of SAMPLE_COURSES) {
      const { key, audience, ...data } = c;
      const course = await ctx.resources.create('course', data);
      courses.set(key, course);
      for (const a of audience) {
        const role = a === 'everyone' ? null : await ctx.db.one<Row>('select id from roles where key = $1', [a]);
        if (a !== 'everyone' && !role) continue;
        await ctx.db.query(
          `insert into training_assignments (course_id, audience_type, role_id) values ($1,$2,$3)`,
          [course.id, role ? 'role' : 'everyone', role?.id ?? null],
        );
        rules++;
      }
    }
    let records = 0;
    for (const r of SAMPLE_RECORDS) {
      const who = SAMPLE_PEOPLE[r.person];
      const person = resolvePerson(who, users);
      if (typeof person === 'string') continue;
      const saved = await saveTraining(ctx.db, courses.get(r.course)!, person, {
        assigned_on: day(r.assigned), due_on: day(r.due),
        completed_on: r.completed === undefined ? null : day(r.completed),
        score: r.score ?? null, result: r.completed === undefined ? null : r.result ?? 'passed',
        evidence_note: r.note ?? null, failed: r.completed !== undefined && r.result === 'failed',
      }, r.source ?? 'manual', today, null);
      if (saved.outcome === 'created' || saved.outcome === 'assigned') records++;
    }
    await ctx.audit(null, {
      action: 'training.seed', recordType: 'training_record',
      summary: `Sample training data added: ${courses.size} courses, ${rules} assignment rules, ${records} records`,
      after: { courses: courses.size, rules, records },
    });
    notes.push(`${courses.size} sample courses, ${rules} rules, ${records} records`);
  }

  if (await ctx.db.one(`select 1 from exercises where title like '[Sample]%' limit 1`)) {
    notes.push('sample exercises already present');
  } else {
    const actions = !!ctx.resources.get('action');
    const systemDef = ctx.resources.get('system');
    const systems = systemDef
      ? await ctx.db.query<Row>(`select id from ${systemDef.table} where deleted_at is null order by created_at, id limit 2`) : [];
    let findings = 0;
    let raised = 0;
    for (const e of SAMPLE_EXERCISES) {
      const { date, next_due, participants, findings: found, ...data } = e;
      const ex = await ctx.resources.create('exercise', {
        ...data, exercise_date: day(date), ...(next_due === undefined ? {} : { next_due_on: day(next_due) }),
      });
      for (const p of participants) {
        await ctx.db.query(
          'insert into exercise_participants (exercise_id, name, role, attended) values ($1,$2,$3,$4)', [ex.id, p.name, p.role, p.attended ?? true],
        );
      }
      for (const f of found) {
        const row = (await ctx.db.one<Row>(
          `insert into exercise_findings (exercise_id, finding, severity, recommendation) values ($1,$2,$3,$4) returning *`,
          [ex.id, f.finding, f.severity, f.recommendation],
        ))!;
        findings++;
        if (actions && f.action_due !== undefined) {
          const action = await createFindingAction(ctx, ex, row, {
            title: `[Sample] ${f.action_title}`, due_on: day(f.action_due),
            // Older follow-ups were finished shortly before they fell due.
            extra: f.action_due < -30 ? { status: 'done', completed_on: day(f.action_due - 3) } : undefined,
          }, null);
          await ctx.db.query('update exercise_findings set action_id = $2 where id = $1', [row.id, action.id]);
          raised++;
        }
      }
      // Generic links to the systems in scope, when the inventory is there.
      for (const s of systems.slice(0, e.type === 'tabletop' ? 2 : 1)) {
        await ctx.db.query(
          `insert into record_links (from_type, from_id, to_type, to_id, relation) values ('exercise', $1, 'system', $2, 'in scope')
           on conflict do nothing`, [ex.id, s.id],
        );
      }
      await ctx.audit(null, {
        action: 'exercise.seed', recordType: 'exercise', recordId: ex.id,
        summary: `Sample exercise detail added: ${participants.length} participants, ${found.length} findings`,
      });
    }
    notes.push(`${SAMPLE_EXERCISES.length} sample exercises, ${findings} findings${actions ? `, ${raised} follow-up actions` : ''}`);
  }

  // Qualifications for the sample roster (dev profile; E29-12).
  const quals = await seedSampleQualifications(ctx, today);
  if (quals) notes.push(quals);

  const sync = await syncTrainingAssignments(ctx, now);
  if (sync.created || sync.renewed) notes.push(`${sync.created + sync.renewed} records raised by rules`);
  return notes.join('; ');
}
