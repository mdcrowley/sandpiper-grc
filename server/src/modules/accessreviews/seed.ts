import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { addDays } from '../../../../shared/dates.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';

/**
 * Invented samples (dev profile only, E41-02): accounts on two sample systems, most of them holding
 * the employee numbers of the sample staff roster (matched when the roster is seeded, which may come
 * after this module), one not on the roster and a shared service account; and a draft campaign over
 * both systems. Idempotent: the campaign is found by title and accounts by system and name.
 */
const CAMPAIGN = '[Sample] Quarterly user access review';

export async function seedAccessReviews(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'samples only in the dev profile';
  if (!ctx.resources.get('system_account')) return 'switched off';
  if (await ctx.db.one('select 1 from access_reviews where title = $1 and deleted_at is null', [CAMPAIGN])) return 'samples already present';
  await seedDevEstate(ctx);
  const systems = await ctx.db.query<Row>(`select id, name from systems where deleted_at is null and name like '[Sample]%' order by name limit 2`);
  if (!systems.length) return 'no sample systems';
  let n = 0;
  for (const [s, system] of systems.entries()) {
    const accounts: Row[] = [];
    for (let i = 0; i < 6; i++) {
      const number = 1001 + s * 4 + i;
      accounts.push({
        account_name: `sample.user${number}`, employee_number: `S-${number}`, role_on_system: i === 0 ? 'Administrator' : 'User',
        privileged: i === 0, last_seen_on: dayInZone(-(i * 9 + s * 5)),
      });
    }
    accounts.push({ account_name: 'sample.contractor', display_name: '[Sample] Invented contractor', role_on_system: 'User', last_seen_on: dayInZone(-120) });
    accounts.push({ account_name: 'svc.sample-interface', account_kind: 'service', role_on_system: 'Interface', last_seen_on: dayInZone(-1) });
    for (const a of accounts) {
      if (await ctx.db.one('select 1 from system_accounts where system_id = $1 and lower(account_name) = lower($2) and deleted_at is null', [system.id, a.account_name])) continue;
      await ctx.resources.create('system_account', { ...a, system_id: system.id });
      n++;
    }
  }
  const review = await ctx.resources.create('access_review', {
    title: CAMPAIGN, description: 'Each system owner keeps or removes every account on their system. Invented sample.',
    starts_on: dayInZone(), due_on: addDays(dayInZone(), 21),
  });
  for (const system of systems) {
    const owner = await ctx.db.one<Row>('select coalesce(business_owner_id, technical_owner_id) as id from systems where id = $1', [system.id]);
    await ctx.db.query('insert into access_review_systems (review_id, system_id, reviewer_id) values ($1, $2, $3) on conflict do nothing', [review.id, system.id, owner?.id ?? null]);
  }
  return `${n} sample accounts on ${systems.length} systems, one draft access review`;
}
