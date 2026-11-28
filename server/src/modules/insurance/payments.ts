// Claim payments one by one (E46-62): each payment made on a claim and each recovery received, with its
// date, payee, amount and kind. The claim's "Paid to date" and "Recovered" are worked out from them
// (kinds whose list value carries `meta.recovery` count as recovered). A payment follows its claim's
// restriction (core `restrictedFrom`), so a restricted claim's payments are seen only by those who may
// see the claim; the figures count every payment.
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { CLAIM } from './claims.ts';

export const PAYMENT = 'insurance_claim_payment';

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** Kinds that bring money back to the organization. */
export async function recoveryKinds(ctx: ModuleContext): Promise<string[]> {
  // `true` as shipped; "yes" when an administrator sets it under Administration > Lists.
  return (await ctx.lookups.values('insurance_payment_kind'))
    .filter((v) => { const r = (v.meta as Record<string, unknown> | undefined)?.recovery; return r === true || r === 'yes'; })
    .map((v) => v.value);
}

/** Works out a claim's paid and recovered totals from its payments, and stores them when they changed. */
export async function retotalClaim(ctx: ModuleContext, claimId: string | null | undefined): Promise<{ paid: number; recovered: number } | null> {
  if (!claimId) return null;
  const recovery = await recoveryKinds(ctx);
  const t = await ctx.db.one<Row>(
    `select coalesce(sum(amount) filter (where not (kind = any($2::text[]))), 0)::float8 as paid,
            coalesce(sum(amount) filter (where kind = any($2::text[])), 0)::float8 as recovered,
            count(*)::int as n
     from insurance_claim_payments where claim_id = $1 and deleted_at is null`, [claimId, recovery]);
  const paid = Number(t?.paid ?? 0);
  const recovered = Number(t?.recovered ?? 0);
  // Derived values: not audited (the payments themselves are), like a certificate's check.
  await ctx.db.query(
    `update insurance_claims set paid = $2, recovered = $3 where id = $1 and (coalesce(paid, 0) <> $2 or coalesce(recovered, 0) <> $3)`,
    [claimId, paid, recovered]);
  return { paid, recovered };
}

export function registerPayments(ctx: ModuleContext) {
  const { db } = ctx;

  async function kindLabel(kind: unknown): Promise<string> {
    return (await ctx.lookups.values('insurance_payment_kind')).find((v) => v.value === kind)?.label ?? 'Payment';
  }

  async function rules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    const amount = num(merged.amount);
    if (amount === null || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter an amount above zero.';
    if (existing && 'claim_id' in patch && String(patch.claim_id) !== String(existing.claim_id)) errors.claim_id = 'A payment stays with its claim.';
    const paidOn = day(merged.paid_on);
    if (merged.claim_id && !errors.claim_id) {
      const claim = await db.one<Row>('select incident_on::text as incident_on from insurance_claims where id = $1 and deleted_at is null', [merged.claim_id]);
      if (!claim) errors.claim_id = 'Choose the claim.';
      else if (paidOn && claim.incident_on && paidOn < claim.incident_on) errors.paid_on = 'A payment cannot be made before the incident.';
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (!existing) {
      patch.source_type = CLAIM;
      const who = actorOf(req);
      patch.recorded_by = who.id;
      patch.recorded_by_name = who.name ?? (req ? null : 'System');
    }
    return patch;
  }

  ctx.defineResource({
    type: PAYMENT, table: 'insurance_claim_payments', module: 'insurance', label: 'Claim payment', plural: 'Claim payments',
    path: '/api/insurance/claim-payments', route: '/insurance/claim-payments', titleField: 'title',
    restricted: 'flag', restrictedFrom: { typeField: 'source_type', idField: 'claim_id' },
    searchable: ['title', 'payee', 'reference', 'note'],
    defaultSort: { field: 'paid_on', dir: 'desc' },
    fields: {
      title: { label: 'Payment', type: 'text', required: true, personal: false, help: 'Made from the kind and the payee when left empty.' },
      claim_id: { label: 'Claim', type: 'ref', to: CLAIM, required: true, help: 'The insurance claim the payment or recovery belongs to.' },
      source_type: { label: 'Source type', type: 'text', readOnly: true, personal: false },
      paid_on: { label: 'Date', type: 'date', required: true, help: 'The day the money was paid or received.' },
      kind: { label: 'Kind', type: 'lookup', list: 'insurance_payment_kind', required: true, help: 'A payment (to the claimant, for repairs, expenses) or a recovery (from the insurer, another party, salvage).' },
      payee: { label: 'Paid to or received from', type: 'text', personal: true, help: 'Who was paid, or who paid the organization (an insurer, another party\'s insurer, a salvage buyer).' },
      amount: { label: 'Amount', type: 'currency', required: true, help: 'Above zero, in the organization\'s currency.' },
      reference: { label: 'Reference', type: 'text', personal: false, help: 'The check, transfer or remittance number.' },
      note: { label: 'Note', type: 'longtext' },
      recorded_by: { label: 'Recorded by (account)', type: 'user', readOnly: true },
      recorded_by_name: { label: 'Recorded by', type: 'text', readOnly: true },
      restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
    },
    hooks: {
      prepare: async (_req, raw, existing) => {
        if (existing || (raw.title && String(raw.title).trim())) return raw;
        const payee = String(raw.payee ?? '').trim();
        return { ...raw, title: `${await kindLabel(raw.kind)}${payee ? `: ${payee}` : ''}`.slice(0, 200) };
      },
      beforeCreate: (req, data) => rules(req, null, data),
      beforeUpdate: (req, existing, patch) => rules(req, existing, patch),
      afterCreate: async (_req, row) => { await retotalClaim(ctx, row.claim_id); },
      afterUpdate: async (_req, _before, after) => { await retotalClaim(ctx, after.claim_id); },
    },
  });

  // A deleted payment changes the totals too.
  ctx.resources.onChange?.(async (change) => {
    if (change.def.type !== PAYMENT || (change.action !== 'delete' && change.action !== 'purge')) return;
    await retotalClaim(ctx, change.row.claim_id);
  });
}
