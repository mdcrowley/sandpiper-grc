// Reminders for overdue milestones and register items (E11-24), sent through `app.notify`
// when the notifications module is loaded; without it nothing is sent.
//
// Each overdue milestone (no done date) and each open register item (risk, issue, decision or
// change request) past its due date is announced once for that due date: an item goes to its
// owner, or to the project manager when it has none; a milestone goes to the project manager.
// Only projects that are active or on hold are looked at. A due date that changes is a new
// occasion, so moving it and missing it again is announced again. Dates are the organization's.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/** Register-item statuses that need nothing more (with any the administrator marks `closed`). */
const FINISHED = ['closed', 'rejected', 'approved'];
const OPEN_PROJECT = ['active', 'on_hold'];

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plain = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));
const label = (p: Row) => [p.project_ref, p.project_name].filter(Boolean).join(' ');

export interface OverdueRun { available: boolean; milestones: number; items: number; notified: number }

export async function runOverdueReminders(ctx: ModuleContext): Promise<OverdueRun> {
  const run: OverdueRun = { available: ctx.app.hasDecorator('notify'), milestones: 0, items: 0, notified: 0 };
  if (!run.available) return run;
  const today = dayInZone();
  const finished = [...new Set([...FINISHED,
    ...(await ctx.lookups.values('project_item_status')).filter((v) => v.meta?.closed === true).map((v) => v.value)])];
  const kinds = new Map((await ctx.lookups.values('project_item_kind')).map((v) => [v.value, v.label]));

  const milestones = await ctx.db.query<Row>(
    `select m.id, m.name, m.due_on::text as due_on, p.id as project_id, p.ref as project_ref, p.name as project_name, p.project_manager_id
     from project_milestones m join projects p on p.id = m.project_id and p.deleted_at is null and p.status = any($2::text[])
     where m.deleted_at is null and m.done_on is null and m.due_on < $1::date
     order by m.due_on limit 2000`,
    [today, OPEN_PROJECT],
  );
  for (const m of milestones) {
    if (!m.project_manager_id) continue;
    const res = await ctx.app.notify({
      userIds: [m.project_manager_id], kind: 'due',
      title: `Milestone overdue: ${m.name} (${label(m)})`,
      body: `It was due on ${plain(m.due_on)}. Mark it done, or move its date.`,
      recordType: 'project', recordId: m.project_id, route: `/projects/${m.project_id}?tab=milestones`,
      once: `project.milestone_overdue:${m.id}:${m.due_on}`,
    });
    run.milestones += 1;
    run.notified += res.sent;
  }

  const items = await ctx.db.query<Row>(
    `select i.id, i.kind, i.title, i.owner_id, i.due_on::text as due_on,
            p.id as project_id, p.ref as project_ref, p.name as project_name, p.project_manager_id
     from project_items i join projects p on p.id = i.project_id and p.deleted_at is null and p.status = any($2::text[])
     where i.deleted_at is null and i.due_on is not null and i.due_on < $1::date and not (coalesce(i.status, '') = any($3::text[]))
     order by i.due_on limit 2000`,
    [today, OPEN_PROJECT, finished],
  );
  for (const i of items) {
    const to = i.owner_id ?? i.project_manager_id;
    if (!to) continue;
    const kind = kinds.get(i.kind) ?? 'Register item';
    const res = await ctx.app.notify({
      userIds: [to], kind: 'due',
      title: `${kind} overdue: ${i.title} (${label(i)})`,
      body: `It was due on ${plain(i.due_on)}.${i.owner_id ? '' : ' It has no owner, so the project manager is told.'}`,
      recordType: 'project', recordId: i.project_id, route: `/projects/${i.project_id}?tab=items`,
      once: `project.item_overdue:${i.id}:${i.due_on}`,
    });
    run.items += 1;
    run.notified += res.sent;
  }
  return run;
}
