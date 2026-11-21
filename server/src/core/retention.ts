import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import { featureState, visibleValues } from './features.ts';
import type { FieldDef, ResourceDef, Row } from './module.ts';
import type { makeResources } from './resource.ts';
import { requirePerm, type makeAudit, type makeLookups } from './services.ts';
import { dayInZone } from './timezone.ts';
import type { RetentionChangeInput } from './webhooks.ts';

/**
 * Retention (E14-11).
 *
 * A retention policy is data: per record type, a period in months, what the period is counted from
 * (`updated_at` or `created_at`) and a schedule category (the configurable list `retention_category`).
 * A daily sweep flags records that are past their period for review. **It never deletes a record.**
 * (The same daily job removes delivery-log rows past their own periods: see LOG_RETENTION.)
 * An administrator then decides each flagged record: keep it for longer (with a reason), anonymize it
 * (E14-19), or remove it for good. What the review of a type may do is the policy's `disposal`:
 * `keep` (only keep longer), `anonymize` (also anonymize) or `delete` (also remove for good).
 * Anonymizing and removing are explicit, identity-confirmed, audited actions that cannot be undone.
 *
 * The audit log is append-only and never changed here: it keeps who changed what, by design. Its own
 * period (`retention.audit_months`) is recorded, not enforced.
 */

const BASES = ['updated_at', 'created_at'];
export const DISPOSALS = ['keep', 'anonymize', 'delete'] as const;
export type Disposal = typeof DISPOSALS[number];
const DISPOSAL_RANK: Record<Disposal, number> = { keep: 0, anonymize: 1, delete: 2 };
/** What anonymizing writes in place of personal text. */
export const ANONYMIZED_TEXT = 'Removed at the end of the retention period';
const UNDECIDED = ['pending', 'extended'];

/** Text fields named like these hold a person's contact details or name. */
const PERSONAL_NAME_RE = /(^|_)(email|phone|mobile)(_|$)|_name$/;
const NOT_PERSONAL_NAMES = /^(host|template|vendor|system|product|asset|file|service|company|organization|supplier|site|model)_name$/;

/**
 * Whether a field holds personal data (FieldDef.personal, E14-19). Default: `user` and `longtext`
 * fields, and text fields named like an email address, a phone number or a person's name.
 */
export function isPersonal(name: string, f: FieldDef): boolean {
  if (f.personal !== undefined) return f.personal;
  if (f.type === 'user' || f.type === 'longtext') return true;
  return f.type === 'text' && PERSONAL_NAME_RE.test(name) && !NOT_PERSONAL_NAMES.test(name);
}

/** The built-in fields of a type that anonymizing replaces. */
export function personalFields(def: ResourceDef): string[] {
  return Object.entries(def.fields).filter(([name, f]) => !f.custom && isPersonal(name, f)).map(([name]) => name);
}

const disposalOf = (p: Row | undefined): Disposal => (DISPOSALS.includes(p?.disposal) ? p!.disposal : 'delete');

/**
 * How long the delivery logs are kept (OP-08), in days: settings an administrator may change
 * (Administration > Settings > Retention), with these defaults and limits. Unlike records, these
 * rows are removed by the daily sweep without review: they are logs, not records.
 * - webhook deliveries: once delivered, failed or blocked (pending ones are never removed);
 * - outgoing mail and text messages (`mail_log`): once sent, given up or skipped;
 * - incoming mail (`mail_inbound_log`, the service desk's mailbox).
 */
export const LOG_RETENTION = {
  'retention.webhook_delivery_days': { fallback: 30, min: 1, max: 3650 },
  'retention.mail_log_days': { fallback: 180, min: 7, max: 3650 },
  'retention.mail_inbound_log_days': { fallback: 180, min: 7, max: 3650 },
} as const;
export type LogRetentionKey = keyof typeof LOG_RETENTION;

/** What a removed or anonymized record's queued and past webhook deliveries are left with. */
export const REDACTED_PAYLOAD = { redacted: true, reason: 'The record was anonymized or removed at the end of its retention period.' };

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

  const tableExists = async (name: string, q: Pick<Db, 'one'> = db) => Boolean((await q.one<{ t: string | null }>('select to_regclass($1)::text as t', [name]))?.t);
  const days = async (key: LogRetentionKey) => {
    const spec = LOG_RETENTION[key];
    const v = Number((await db.one<{ value: unknown }>('select value from settings where key = $1', [key]))?.value);
    return Number.isInteger(v) && v >= spec.min && v <= spec.max ? v : spec.fallback;
  };

  /**
   * Removes delivery-log rows past their period (OP-08), and empties the content of webhook
   * deliveries already delivered (it is only needed to send them, or to try again). Runs with the
   * daily sweep. Returns how many rows each step removed or emptied.
   */
  async function housekeeping(): Promise<{ webhookDeliveries: number; webhookPayloads: number; mailLog: number; mailInboundLog: number }> {
    const out = { webhookDeliveries: 0, webhookPayloads: 0, mailLog: 0, mailInboundLog: 0 };
    if (await tableExists('webhook_deliveries')) {
      out.webhookPayloads = (await db.query(
        `update webhook_deliveries set payload = '{}'::jsonb where status = 'delivered' and payload <> '{}'::jsonb returning 1`)).length;
      out.webhookDeliveries = (await db.query(
        `delete from webhook_deliveries where status <> 'pending'
           and coalesce(delivered_at, last_attempt_at, created_at) < now() - make_interval(days => $1::int) returning 1`,
        [await days('retention.webhook_delivery_days')])).length;
    }
    if (await tableExists('mail_log')) {
      out.mailLog = (await db.query(
        `delete from mail_log where status not in ('queued', 'failed') and created_at < now() - make_interval(days => $1::int) returning 1`,
        [await days('retention.mail_log_days')])).length;
    }
    if (await tableExists('mail_inbound_log')) {
      out.mailInboundLog = (await db.query(
        'delete from mail_inbound_log where received_at < now() - make_interval(days => $1::int) returning 1',
        [await days('retention.mail_inbound_log_days')])).length;
    }
    const removed = out.webhookDeliveries + out.mailLog + out.mailInboundLog;
    if (removed) {
      await audit(null, {
        action: 'retention.housekeeping',
        summary: `Delivery logs past their retention period removed: ${out.webhookDeliveries} webhook deliveries, `
          + `${out.mailLog} outgoing messages, ${out.mailInboundLog} incoming emails`,
      });
    }
    return out;
  }

  /**
   * Webhook deliveries keep the record's fields as they were sent (OP-08): once a record is
   * anonymized or removed at the end of its retention period, their content is replaced, and those
   * still waiting are not sent (blocked, with the reason). Their date, event and status stay.
   */
  async function scrubDeliveries(q: Pick<Db, 'query' | 'one'>, type: string, id: string): Promise<number> {
    if (!(await tableExists('webhook_deliveries', q))) return 0; // on q: inside a transaction, the outer handle would wait for ever
    return (await q.query(
      `update webhook_deliveries set payload = $3::jsonb,
         status = case when status = 'pending' then 'blocked' else status end,
         last_error = case when status = 'pending' then $4 else last_error end
       where record_type = $1 and record_id = $2 returning 1`,
      [type, id, JSON.stringify(REDACTED_PAYLOAD), 'Not sent: the record was anonymized or removed at the end of its retention period.'])).length;
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
          disposal: disposalOf(p),
          personalFields: personalFields(d).map((f) => d.fields[f].label),
        };
      }).sort((a, b) => a.label.localeCompare(b.label)),
      categories: visibleValues(await featureState(db), 'retention_category', await lookups.values('retention_category')),
      bases: BASES,
      disposals: DISPOSALS,
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
    const before = await db.one<Row>('select * from retention_policies where record_type = $1', [def!.type]);
    const disposal = b.disposal === undefined ? disposalOf(before) : String(b.disposal);
    if (!DISPOSALS.includes(disposal as Disposal)) fields.disposal = 'Choose keep, anonymize or remove for good.';
    if (Object.keys(fields).length) invalid(fields);
    const row = await db.one<Row>(
      `insert into retention_policies (record_type, period_months, category, basis, active, notes, updated_by, disposal) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (record_type) do update set period_months = excluded.period_months, category = excluded.category, basis = excluded.basis,
         active = excluded.active, notes = excluded.notes, disposal = excluded.disposal, updated_at = now(), updated_by = excluded.updated_by returning *`,
      [def!.type, months, category, basis, b.active !== false, String(b.notes ?? '').trim().slice(0, 500) || null, req.user!.id, disposal]);
    const allows = { keep: 'only keeping longer', anonymize: 'keeping longer or anonymizing', delete: 'keeping longer, anonymizing or removing for good' }[disposal as Disposal];
    await audit(req, {
      action: 'retention.policy', recordType: 'retention_policy', recordId: def!.type,
      summary: `Retention for ${def!.plural.toLowerCase()} set to ${months} months, review allows ${allows}${row!.active ? '' : ' (not active)'}`, before, after: row,
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
    const status = ['pending', 'extended', 'anonymized', 'deleted'].includes(q.status) ? q.status : 'pending';
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
    const row = UUID_RE.test(id) ? await db.one<Row>(`select * from retention_reviews where id = $1 and status = any($2::text[])`, [id, UNDECIDED]) : undefined;
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
  /** Refuses a decision the type's policy does not allow (its `disposal`). */
  const mustAllow = async (def: ResourceDef, wanted: Disposal) => {
    const disposal = disposalOf(await db.one<Row>('select disposal from retention_policies where record_type = $1', [def.type]));
    if (DISPOSAL_RANK[disposal] >= DISPOSAL_RANK[wanted]) return;
    fail(409, 'not_allowed', disposal === 'keep'
      ? `The retention policy for ${def.plural.toLowerCase()} only allows keeping them longer. An administrator can change it under Retention periods.`
      : `The retention policy for ${def.plural.toLowerCase()} allows anonymizing, not removing for good. An administrator can change it under Retention periods.`);
  };
  /** The webhook events of a decision (E14-33). Never fails the decision, which is already made. */
  const raiseWebhooks = async (input: RetentionChangeInput) => {
    try {
      await app.webhookRetentionChange?.(input);
    } catch (err) {
      console.error('[retention] webhook events not queued:', err);
    }
  };
  const filesTable = async () => Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t);

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
    await mustAllow(def, 'delete');
    await requireRecentAuth(req, `removing a ${def.label.toLowerCase()} for good`);
    const existing = await db.one<Row>(`select * from ${def.table} where id = $1 and ${res.visibilitySql(def, req.user)}`, [review.record_id]);
    if (!existing) fail(404, 'not_found', 'Record not found.');
    // Files belong to the attachments module: they are removed there first, so no bytes are orphaned.
    const hasFiles = await filesTable()
      && await db.one('select 1 from attachments where record_type = $1 and record_id = $2 and deleted_at is null limit 1', [def.type, review.record_id]);
    if (hasFiles) fail(409, 'has_attachments', 'This record still has files attached. Remove them first.');
    const label = res.labelOf(def, existing!);
    await res.purge(def.type, review.record_id, req);
    await scrubDeliveries(db, def.type, review.record_id); // before the deletion itself is sent, below
    const row = await db.one<Row>(
      `update retention_reviews set status = 'deleted', record_label = $2, reason = $3, decided_at = now(), decided_by = $4 where id = $1 returning *`,
      [review.id, def.ref ? existing![def.ref.field] ?? label : label, reason, req.user!.id]);
    await audit(req, {
      action: 'retention.delete', recordType: review.record_type, recordId: review.record_id,
      summary: `${def.label} ${label} removed for good at the end of its retention period: ${reason}`,
    });
    // Systems that mirror records through webhooks drop it too (E14-33); only its id and reference are sent.
    await raiseWebhooks({ action: 'deleted', def, row: existing!, req });
    return row;
  });

  /**
   * Anonymizes a record (E14-19): its personal fields (FieldDef.personal, and custom long-text and
   * person fields) are replaced, its comments' text and authors, the titles of notifications about
   * it and the names and contents of its files are removed, and its watchers are dropped. Its shape
   * and figures stay: the row, its status, dates, numbers, tags, links and the count of its comments
   * and files. The search index follows through its triggers. The audit log is not changed.
   */
  async function anonymize(def: ResourceDef, id: string): Promise<{ fields: string[]; keys: string[]; comments: number; files: number; kept: string[] }> {
    const row = (await db.one<Row>(`select * from ${def.table} where id = $1`, [id])) ?? fail(404, 'not_found', 'Record not found.');
    const nullable = new Map((await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns where table_schema = current_schema() and table_name = $1`, [def.table],
    )).map((c) => [c.column_name, c.is_nullable === 'YES']));
    const sets: string[] = [];
    const params: unknown[] = [id];
    const changed: string[] = [];
    const keys: string[] = []; // the same fields by key, for the webhook events (E14-33)
    const kept: string[] = [];
    for (const name of personalFields(def)) {
      const f = def.fields[name];
      if (!nullable.has(name) || row[name] === null || row[name] === undefined) continue;
      let value: unknown;
      if (f.type === 'text' || f.type === 'longtext') value = ANONYMIZED_TEXT;
      else if (nullable.get(name)) value = null;
      else if (f.type === 'json') value = {};
      else { kept.push(f.label); continue; } // a required person or other value: nothing can stand in for it
      params.push(f.type === 'json' && value !== null ? JSON.stringify(value) : value);
      sets.push(`${name} = $${params.length}`);
      changed.push(f.label);
      keys.push(name);
    }
    // Custom fields, including ones no longer in use: long text and people.
    if (nullable.has('custom') && row.custom && typeof row.custom === 'object') {
      const custom = { ...row.custom };
      const cfs = await db.query<{ key: string; label: string; type: string }>('select key, label, type from custom_fields where record_type = $1', [def.type]);
      for (const cf of cfs) {
        if (custom[cf.key] === null || custom[cf.key] === undefined || custom[cf.key] === '') continue;
        if (cf.type === 'longtext') custom[cf.key] = ANONYMIZED_TEXT;
        else if (cf.type === 'user') custom[cf.key] = null;
        else continue;
        changed.push(cf.label);
        keys.push(`cf_${cf.key}`);
      }
      params.push(JSON.stringify(custom));
      sets.push(`custom = $${params.length}::jsonb`);
    }
    for (const who of ['created_by', 'updated_by']) if (nullable.get(who)) sets.push(`${who} = null`);

    let files: Row[] = [];
    if (await filesTable()) {
      files = await db.query<Row>('select * from attachments where record_type = $1 and record_id = $2', [def.type, id]);
      if (files.some((f) => !f.purged_at) && !app.hasDecorator('attachmentStores')) {
        fail(409, 'files_unavailable', 'This record has files, and the files part of the application is not running, so their contents cannot be removed.');
      }
    }
    // The stored bytes first: a file whose content cannot be deleted stops the whole change.
    const stores = (app as unknown as { attachmentStores?: { forDriver(d: string): { delete(key: string): Promise<void> } } }).attachmentStores;
    for (const f of files.filter((x) => !x.purged_at)) {
      try {
        await stores!.forDriver(f.storage_driver).delete(f.storage_key);
      } catch (err) {
        fail(502, 'storage_failed', `The content of a file on this record could not be deleted (${(err as Error).message}). Nothing was anonymized; try again.`);
      }
    }
    let comments = 0;
    await db.tx(async (tx) => {
      if (sets.length) await tx.query(`update ${def.table} set ${sets.join(', ')} where id = $1`, params);
      comments = (await tx.query(
        `update comments set body = $3, author_id = null, author_name = null where record_type = $1 and record_id = $2 returning 1`,
        [def.type, id, ANONYMIZED_TEXT])).length;
      await tx.query('delete from record_watchers where record_type = $1 and record_id = $2', [def.type, id]);
      await scrubDeliveries(tx, def.type, id);
      if (files.length) {
        await tx.query(
          `update attachments set file_name = 'Removed file' || case when extension <> '' then '.' || extension else '' end,
             description = null, uploaded_by_name = null, created_by = null, updated_by = null,
             deleted_at = coalesce(deleted_at, now()), purged_at = coalesce(purged_at, now()), removed_reason = 'anonymized', updated_at = now()
           where record_type = $1 and record_id = $2`, [def.type, id]);
      }
      if ((await tx.one<{ t: string | null }>(`select to_regclass('public.notifications')::text as t`))?.t) {
        await tx.query(`update notifications set title = $3, body = null where record_type = $1 and record_id = $2`,
          [def.type, id, `${def.label} (details removed at the end of its retention period)`]);
      }
    });
    return { fields: changed, keys, comments, files: files.length, kept };
  }

  // Anonymize the record: keep its shape and figures, remove the personal details. Cannot be undone.
  app.post('/api/admin/retention/reviews/:id/anonymize', admin, async (req) => {
    const { review, def } = await reviewOf(req);
    const b = (req.body ?? {}) as Row;
    const reason = reasonOf(b);
    if (b.confirm !== true) invalid({ confirm: 'Confirm that the personal details are to be removed for good.' });
    await mustAllow(def, 'anonymize');
    await requireRecentAuth(req, `anonymizing a ${def.label.toLowerCase()}`);
    const existing = await db.one<Row>(`select * from ${def.table} where id = $1 and ${res.visibilitySql(def, req.user)}`, [review.record_id]);
    if (!existing) fail(404, 'not_found', 'Record not found.');
    // The reference only: the title may itself be personal.
    const name = (def.ref && existing![def.ref.field]) || `(${review.record_id})`;
    const done = await anonymize(def, review.record_id);
    const row = await db.one<Row>(
      `update retention_reviews set status = 'anonymized', record_label = $2, reason = $3, decided_at = now(), decided_by = $4 where id = $1 returning *`,
      [review.id, name, reason, req.user!.id]);
    const parts = [
      `${done.fields.length} field${done.fields.length === 1 ? '' : 's'}${done.fields.length ? ` (${done.fields.join(', ')})` : ''}`,
      `${done.comments} comment${done.comments === 1 ? '' : 's'}`, `${done.files} file${done.files === 1 ? '' : 's'}`,
    ];
    await audit(req, {
      action: 'retention.anonymize', recordType: review.record_type, recordId: review.record_id,
      summary: `${def.label} ${name} anonymized at the end of its retention period (${parts.join(', ')})`
        + `${done.kept.length ? `; kept because required: ${done.kept.join(', ')}` : ''}: ${reason}`,
    });
    // Systems that mirror records through webhooks replace what they were sent (E14-33).
    const now = await db.one<Row>(`select * from ${def.table} where id = $1`, [review.record_id]);
    if (now) await raiseWebhooks({ action: 'anonymized', def, row: now, fields: done.keys, comments: done.comments, files: done.files, req });
    return { ...row, anonymized: done };
  });

  return { sweep, anonymize, housekeeping };
}
