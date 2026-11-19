import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { Row } from './module.ts';
import type { makeResources } from './resource.ts';
import { requirePerm, type makeAudit, type makeLookups } from './services.ts';
import { dayInZone } from './timezone.ts';

/**
 * Retention (E14-11).
 *
 * A retention policy is data: per record type, a period in months, what the period is counted from
 * (`updated_at` or `created_at`) and a schedule category (the configurable list `retention_category`).
 * A daily sweep flags records that are past their period for review. **It never deletes anything.**
 * An administrator then decides each flagged record: keep it for longer (with a reason), or remove
 * it for good, which is an explicit, password-confirmed, audited action.
 */

const BASES = ['updated_at', 'created_at'];

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  lookups: ReturnType<typeof makeLookups>;
  res: ReturnType<typeof makeResources>;
  requireRecentAuth(req: FastifyRequest, what: string): Promise<void>;
}

export function registerRetention({ app, db, audit, lookups, res, requireRecentAuth }: Deps) {
  const admin = { preHandler: requirePerm('admin.administer') };
  const invalid = (fields: Record<string, string>): never => fail(400, 'validation', 'Check the highlighted fields.', fields);

  /**
   * Flags records past their retention period. Soft-deleted records count too: they are still held.
   * A record whose review was extended is flagged again only once the extension has run out.
   */
  async function sweep(): Promise<{ flagged: number; byType: Record<string, number> }> {
    const byType: Record<string, number> = {};
    const policies = await db.query<Row>('select * from retention_policies where active and period_months > 0');
    for (const p of policies) {
      const def = res.registry.get(p.record_type);
      if (!def || !BASES.includes(p.basis)) continue;
      const reopened = await db.query(
        `update retention_reviews set status = 'pending', flagged_at = now(), decided_at = null, decided_by = null
         where record_type = $1 and status = 'extended' and extended_until < current_date returning 1`, [def.type]);
      const added = await db.query(
        `insert into retention_reviews (record_type, record_id, basis_at)
         select $1, t.id, t.${p.basis} from ${def.table} t
         where t.${p.basis} < now() - make_interval(months => $2::int)
         on conflict (record_type, record_id) do nothing returning 1`, [def.type, p.period_months]);
      const n = reopened.length + added.length;
      if (!n) continue;
      byType[def.type] = n;
      await audit(null, {
        action: 'retention.flag', recordType: def.type,
        summary: `${n} ${def.plural.toLowerCase()} past the ${p.period_months}-month retention period flagged for review`,
      });
    }
    return { flagged: Object.values(byType).reduce((a, b) => a + b, 0), byType };
  }

  // The daily sweep runs on the job queue, scheduled by core in app.ts (E14-23).
  app.addHook('onReady', async () => {
    await lookups.ensure('retention_category', [
      { value: 'operational', label: 'Operational records' },
      { value: 'security', label: 'Security records' },
      { value: 'contractual', label: 'Contracts and suppliers' },
      { value: 'governance', label: 'Governance and assurance' },
    ], { module: 'admin' });
  });

  // ---------- policies ----------

  app.get('/api/admin/retention', admin, async () => {
    const policies = new Map((await db.query<Row>('select * from retention_policies')).map((p) => [p.record_type, p]));
    const pending = new Map((await db.query<{ record_type: string; c: number }>(
      `select record_type, count(*)::int c from retention_reviews where status = 'pending' group by 1`)).map((r) => [r.record_type, r.c]));
    return {
      types: res.registry.all().map((d) => {
        const p = policies.get(d.type);
        return {
          type: d.type, label: d.label, plural: d.plural, restricted: d.restricted ?? false,
          periodMonths: p?.period_months ?? null, category: p?.category ?? null, basis: p?.basis ?? 'updated_at',
          active: p?.active ?? false, notes: p?.notes ?? null, updatedAt: p?.updated_at ?? null, pendingReviews: pending.get(d.type) ?? 0,
        };
      }).sort((a, b) => a.label.localeCompare(b.label)),
      categories: await lookups.values('retention_category'),
      bases: BASES,
    };
  });

  app.put('/api/admin/retention/:type', admin, async (req) => {
    const def = res.registry.get(String((req.params as Row).type));
    if (!def) fail(404, 'not_found', 'Unknown record type.');
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const months = Number(b.periodMonths);
    if (!Number.isInteger(months) || months < 1 || months > 1200) fields.periodMonths = 'Enter a whole number of months from 1 to 1200.';
    const basis = b.basis === undefined ? 'updated_at' : String(b.basis);
    if (!BASES.includes(basis)) fields.basis = 'Count from when the record was last updated or when it was created.';
    const category = b.category ? String(b.category) : null;
    if (category && !(await lookups.values('retention_category')).some((v) => v.value === category)) fields.category = 'Choose a schedule category from the list.';
    if (Object.keys(fields).length) invalid(fields);
    const before = await db.one<Row>('select * from retention_policies where record_type = $1', [def!.type]);
    const row = await db.one<Row>(
      `insert into retention_policies (record_type, period_months, category, basis, active, notes, updated_by) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (record_type) do update set period_months = excluded.period_months, category = excluded.category, basis = excluded.basis,
         active = excluded.active, notes = excluded.notes, updated_at = now(), updated_by = excluded.updated_by returning *`,
      [def!.type, months, category, basis, b.active !== false, String(b.notes ?? '').trim().slice(0, 500) || null, req.user!.id]);
    await audit(req, {
      action: 'retention.policy', recordType: 'retention_policy', recordId: def!.type,
      summary: `Retention for ${def!.plural.toLowerCase()} set to ${months} months${row!.active ? '' : ' (not active)'}`, before, after: row,
    });
    return row;
  });

  app.post('/api/admin/retention/sweep', admin, async (req) => {
    const result = await sweep();
    await audit(req, { action: 'retention.sweep', summary: `Retention check run by hand: ${result.flagged} record(s) flagged` });
    return result;
  });

  // ---------- review ----------

  app.get('/api/admin/retention/reviews', admin, async (req) => {
    const q = req.query as Record<string, string>;
    const status = ['pending', 'extended', 'deleted'].includes(q.status) ? q.status : 'pending';
    const type = q.record_type && res.registry.get(q.record_type) ? q.record_type : null;
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
    // This is a drill-down list, so it shows only what the reviewer may see (E14-20): restricted types
    // only to someone who may see them, and of a type with restricted rows (`restricted: 'flag'`), only
    // the rows the reviewer may see. A record that no longer exists has no flag to hide it, so it stays
    // listed. The pending counts on GET /api/admin/retention are figures and count every record.
    const visibleDefs = res.registry.all().filter((d) => res.mayAccess(req.user, d, 'view'));
    const visibleTypes = visibleDefs.map((d) => d.type);
    const rowRules = visibleDefs
      .filter((d) => d.restricted === 'flag' && res.visibilitySql(d, req.user, 't') !== 'true')
      .map((d) => `(record_type <> '${d.type}' or not exists (select 1 from ${d.table} t where t.id = retention_reviews.record_id and not (${res.visibilitySql(d, req.user, 't')})))`);
    const where = `status = $1 and ($2::text is null or record_type = $2) and record_type = any($3::text[])${rowRules.map((r) => ` and ${r}`).join('')}`;
    const total = (await db.one<{ c: number }>(`select count(*)::int c from retention_reviews where ${where}`, [status, type, visibleTypes]))!.c;
    const rows = await db.query<Row>(
      `select id, record_type, record_id, record_label, flagged_at, basis_at, status, extended_until, reason, decided_at, decided_by
       from retention_reviews where ${where} order by basis_at nulls last, flagged_at, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
      [status, type, visibleTypes]);
    const names = await res.userNames(rows.map((r) => r.decided_by));
    const out: Row[] = [];
    for (const t of new Set(rows.map((r) => r.record_type))) {
      const def = res.registry.get(t)!;
      const labels = await res.labelsFor(t, rows.filter((r) => r.record_type === t).map((r) => r.record_id), req.user);
      for (const r of rows.filter((x) => x.record_type === t)) {
        const l = labels.get(r.record_id);
        out.push({
          ...r, typeLabel: def.label, route: r.status === 'deleted' ? null : `${def.route}/${r.record_id}`,
          label: r.status === 'deleted' ? r.record_label : l?.label ?? 'Record no longer exists', ref: l?.ref ?? null,
          decided_by_name: r.decided_by ? names.get(r.decided_by) ?? 'Unknown user' : null,
        });
      }
    }
    const order = new Map(rows.map((r, i) => [r.id, i]));
    out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { rows: out, total, page, pageSize };
  });

  const reviewOf = async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`select * from retention_reviews where id = $1 and status <> 'deleted'`, [id]) : undefined;
    const def = row ? res.registry.get(row.record_type) : undefined;
    if (!row || !def || !res.mayAccess(req.user, def, 'view')) fail(404, 'not_found', 'Review not found.');
    // A row the reviewer may not see (a restricted row of a 'flag' type) is not theirs to decide.
    const rule = res.visibilitySql(def!, req.user, 't');
    if (rule !== 'true' && await db.one(`select 1 from ${def!.table} t where t.id = $1 and not (${rule})`, [row!.record_id])) {
      fail(404, 'not_found', 'Review not found.');
    }
    return { review: row!, def: def! };
  };
  const reasonOf = (b: Row) => {
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 5 || reason.length > 1000) invalid({ reason: 'Give a reason (5 to 1000 characters).' });
    return reason;
  };

  // Keep the record for longer: it leaves the list and is flagged again after the date given.
  app.post('/api/admin/retention/reviews/:id/extend', admin, async (req) => {
    const { review, def } = await reviewOf(req);
    const b = (req.body ?? {}) as Row;
    const reason = reasonOf(b);
    const months = Number(b.months);
    const until = b.until ? String(b.until) : Number.isInteger(months) && months > 0 && months <= 1200
      ? dayInZone(Math.round(months * 30.4375)) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until)) || until <= dayInZone()) {
      invalid({ until: 'Give a future date (YYYY-MM-DD) or a number of months.' });
    }
    const row = await db.one<Row>(
      `update retention_reviews set status = 'extended', extended_until = $2, reason = $3, decided_at = now(), decided_by = $4 where id = $1 returning *`,
      [review.id, until, reason, req.user!.id]);
    await audit(req, {
      action: 'retention.extend', recordType: review.record_type, recordId: review.record_id,
      summary: `${def.label} kept past its retention period until ${until}: ${reason}`,
    });
    return row;
  });

  // Remove the record for good. The only hard delete in the application.
  app.post('/api/admin/retention/reviews/:id/delete', admin, async (req) => {
    const { review, def } = await reviewOf(req);
    const b = (req.body ?? {}) as Row;
    const reason = reasonOf(b);
    if (b.confirm !== true) invalid({ confirm: 'Confirm that the record is to be removed for good.' });
    await requireRecentAuth(req, `removing a ${def.label.toLowerCase()} for good`);
    const existing = await db.one<Row>(`select * from ${def.table} where id = $1 and ${res.visibilitySql(def, req.user)}`, [review.record_id]);
    if (!existing) fail(404, 'not_found', 'Record not found.');
    // Files belong to the attachments module: they are removed there first, so no bytes are orphaned.
    const hasFiles = (await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t
      && await db.one('select 1 from attachments where record_type = $1 and record_id = $2 and deleted_at is null limit 1', [def.type, review.record_id]);
    if (hasFiles) fail(409, 'has_attachments', 'This record still has files attached. Remove them first.');
    const label = res.labelOf(def, existing!);
    await res.purge(def.type, review.record_id, req);
    const row = await db.one<Row>(
      `update retention_reviews set status = 'deleted', record_label = $2, reason = $3, decided_at = now(), decided_by = $4 where id = $1 returning *`,
      [review.id, def.ref ? existing![def.ref.field] ?? label : label, reason, req.user!.id]);
    await audit(req, {
      action: 'retention.delete', recordType: review.record_type, recordId: review.record_id,
      summary: `${def.label} ${label} removed for good at the end of its retention period: ${reason}`,
    });
    return row;
  });

  return { sweep };
}
