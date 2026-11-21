import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { PENDING_VERIFICATION, verifiedNow } from './actions-resource.ts';
import { CAP_KIND } from './caps.ts';

// Sample corrective action plans (E23-10): four invented plans on the sample risks, one in each
// interesting state (awaiting approval, verifying, closed as effective, reopened after a
// not-effective verification). Other modules seed plans for their own records.

const day = (offset: number): string => dayInZone(offset);

interface SampleAction { title: string; due: number; finished?: number; verified?: 'effective' | 'not_effective'; method?: string; note?: string }
interface SamplePlan {
  risk: string; title: string; problem: string; cause: string; category: string; due: number;
  state: 'submitted' | 'approved'; actions: SampleAction[]; summary?: string;
}

const PLANS: SamplePlan[] = [
  {
    risk: '[Sample] CAD/AVL outage during peak service', title: '[Sample] Dispatch failover not tested',
    problem: 'Invented example. The yearly exercise found that nobody had tested failover of the dispatch servers to the backup control room.',
    cause: 'The failover test was not on any schedule after the last system upgrade.', category: 'process', due: 40, state: 'submitted',
    actions: [{ title: 'Add a quarterly failover test to the operations calendar', due: 20 }],
  },
  {
    risk: '[Sample] Ransomware on the fare collection system', title: '[Sample] Fare system administrators without a second factor',
    problem: 'Invented example. Two fare system administrator accounts could sign in with a password alone.',
    cause: 'Administrator accounts were created outside the normal joiner process.', category: 'process', due: 10, state: 'approved',
    actions: [
      { title: 'Enroll the remaining administrators in the second factor', due: -10, finished: -12, verified: 'effective', method: 'record_review', note: 'Sign-in report shows every administrator using the second factor.' },
      { title: 'Route new administrator accounts through the joiner process', due: -2, finished: -3 },
    ],
  },
  {
    risk: '[Sample] Ransomware on the fare collection system', title: '[Sample] Fare database backup restore failed',
    problem: 'Invented example. A restore test of the fare database backup failed because the backup job had stopped.',
    cause: 'A storage change disabled the backup job without an alert.', category: 'equipment', due: -15, state: 'approved',
    summary: 'Invented example. Two monthly restore tests since the fix both succeeded.',
    actions: [
      { title: 'Re-enable the backup job and alert on its failure', due: -40, finished: -42, verified: 'effective', method: 'data_trend', note: 'Backup job report shows no failed nights since the change.' },
      { title: 'Repeat the restore test', due: -25, finished: -26, verified: 'effective', method: 're_inspection', note: 'Restore completed in under two hours.' },
    ],
  },
  {
    risk: '[Sample] CAD/AVL outage during peak service', title: '[Sample] Manual dispatch procedure not followed',
    problem: 'Invented example. During a short outage controllers did not switch to the manual dispatch procedure.',
    cause: 'Controllers had not been briefed on the new procedure.', category: 'training', due: 30, state: 'approved',
    actions: [
      { title: 'Brief every controller on the manual dispatch procedure', due: -5, finished: -8, verified: 'not_effective', method: 'observation', note: 'Invented example. At the drill two of five controllers still used the old steps; brief again with a walk-through.' },
    ],
  },
];

/** Dev profile only: a pilot installation starts without invented plans. */
export async function seedCaps(ctx: ModuleContext, opts: SeedOptions): Promise<string | null> {
  if (opts.profile !== 'dev') return null;
  if (!ctx.resources.get('cap')) return null;
  if (await ctx.db.one(`select 1 from caps where title like '[Sample]%' limit 1`)) return null;
  const owner = (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  let added = 0;
  for (const p of PLANS) {
    const risk = await ctx.db.one<Row>('select id from risks where title = $1 and deleted_at is null', [p.risk]);
    if (!risk) continue;
    const cap = await ctx.resources.create('cap', {
      title: p.title, source: 'risk', source_type: 'risk', source_id: risk.id, problem_statement: p.problem,
      root_cause: p.cause, root_cause_category: p.category, responsible_id: owner, due_on: day(p.due),
    });
    for (const a of p.actions) {
      await ctx.resources.create('action', {
        title: a.title, cap_id: cap.id, priority: 'high', owner_id: owner, verifier_id: owner, due_on: day(a.due), verification_required: true,
      });
    }
    if (p.state === 'submitted') {
      await ctx.resources.update('cap', cap.id, { status: 'submitted' });
      const eng = approvalEngine(ctx.app);
      const started = eng ? await eng.start(CAP_KIND, { ...cap, status: 'submitted' }, { requester: owner, req: null, note: p.title }) : null;
      if (!started) await ctx.resources.update('cap', cap.id, { status: 'approved', approved_on: day(-1), approved_by_name: 'Sample approver' });
    } else {
      await ctx.resources.update('cap', cap.id, { status: 'approved', approved_on: day(-45), approved_by_name: 'Sample approver' });
      const actions = await ctx.db.query<Row>('select id, title from actions where cap_id = $1 order by created_at', [cap.id]);
      for (const a of p.actions) {
        const row = actions.find((x) => x.title === a.title);
        if (!row || a.finished === undefined) continue;
        await ctx.resources.update('action', row.id, { status: PENDING_VERIFICATION, completed_on: day(a.finished), verification_due: day(a.finished + 30) });
        if (!a.verified) continue;
        const recorded = { verified_by: owner, verified_on: day(a.finished + 2), verification_method: a.method, verification_result: a.verified, verification_note: a.note ?? null };
        if (a.verified === 'not_effective') {
          await ctx.resources.update('action', row.id, { ...recorded, status: 'in_progress', completed_on: null });
        } else {
          verifiedNow.add(row.id);
          try { await ctx.resources.update('action', row.id, { ...recorded, status: 'done' }); } finally { verifiedNow.delete(row.id); }
        }
      }
      if (p.summary) await ctx.resources.update('cap', cap.id, { effectiveness_summary: p.summary });
      // A plan closed by its last verification: date it then, not on the day the samples were loaded.
      const lastCheck = Math.max(...p.actions.map((a) => (a.verified === 'effective' && a.finished !== undefined ? a.finished + 2 : -Infinity)));
      if (Number.isFinite(lastCheck) && (await ctx.db.one<Row>('select status from caps where id = $1', [cap.id]))?.status === 'closed') {
        await ctx.resources.update('cap', cap.id, { closed_on: day(lastCheck) });
      }
    }
    added += 1;
  }
  return added ? `${added} sample corrective action plans added` : null;
}
