// Procurements (solicitations) and the offers received (E46): the record types, their rules, and who may
// read offers and scores before the award.
import type { FastifyRequest } from 'fastify';
import { isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { flagged, OPEN_FALLBACK } from './lists.ts';
import { day, invalid, num } from './shared.ts';

export const PROCUREMENT = 'procurement';
export const OFFER = 'procurement_offer';

/** Procurement staff: may read offers and scores before the award, and run evaluations. */
export const STAFF_PERMISSION = 'procurement.edit';

/** SQL: the procurement of the row (column `procurement_id`) has an award recorded. */
export const awardedSql = (procCol: string) =>
  `exists (select 1 from procurements p_aw where p_aw.id = ${procCol} and p_aw.awarded_on is not null)`;
/** SQL: `userId` sits on the evaluation committee of the procurement in `procCol`. */
export const evaluatorSql = (procCol: string, userId: string) =>
  (UUID_RE.test(userId) ? `exists (select 1 from procurement_evaluators e_ev where e_ev.procurement_id = ${procCol} and e_ev.user_id = '${userId}')` : 'false');

export const isStaff = (ctx: ModuleContext, user: SessionUser | null | undefined) => Boolean(user && ctx.can(user, STAFF_PERMISSION));

/** The procurement method's settings (from the list value's meta). */
export async function methodOf(ctx: ModuleContext, method: string | null | undefined): Promise<{ label: string; maxValue: number | null; justification: boolean; evaluation: 'scored' | 'price' | 'none' }> {
  const v = (await ctx.lookups.values('procurement_method')).find((m) => m.value === method);
  const meta = (v?.meta ?? {}) as Row;
  const max = meta.max_value === undefined || meta.max_value === null || meta.max_value === '' ? null : Number(meta.max_value);
  const ev = meta.evaluation === 'price' || meta.evaluation === 'none' ? meta.evaluation : 'scored';
  return { label: v?.label ?? method ?? '', maxValue: Number.isFinite(max) ? max : null, justification: meta.justification === 'yes', evaluation: ev };
}

export async function openStatuses(ctx: ModuleContext): Promise<string[]> {
  return flagged(ctx, 'procurement_status', 'open', OPEN_FALLBACK);
}

export function registerSolicitations(ctx: ModuleContext) {
  const { db } = ctx;

  async function procurementRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    for (const f of ['estimated_value', 'independent_estimate']) {
      if (merged[f] !== null && merged[f] !== undefined && merged[f] !== '' && Number(merged[f]) < 0) errors[f] = 'Give an amount of zero or more.';
    }
    const issued = day(merged.issued_on);
    const questions = day(merged.questions_due_on);
    const due = day(merged.proposals_due_at);
    if (issued && questions && questions < issued) errors.questions_due_on = 'Questions cannot be due before the solicitation is issued.';
    if (questions && due && due < questions) errors.proposals_due_at = 'Offers cannot be due before questions are.';
    if (issued && due && due < issued) errors.proposals_due_at = 'Offers cannot be due before the solicitation is issued.';
    const load = isDataLoad(req);
    // The organization's own limit for the method (Lists > Procurement method): a method whose limit is
    // lower than the estimate cannot be used. History loads as it was.
    if (!load && ('method' in patch || 'estimated_value' in patch) && merged.method && merged.estimated_value != null && merged.estimated_value !== '') {
      const m = await methodOf(ctx, merged.method);
      if (m.maxValue !== null && Number(merged.estimated_value) > m.maxValue) {
        errors.estimated_value = `Above the limit for ${m.label.toLowerCase()} (${m.maxValue.toLocaleString('en-US')}). Choose a method that allows this amount.`;
      }
    }
    // A sole-source or emergency purchase is justified in writing before it leaves planning.
    if (!load && 'status' in patch && patch.status && !['planning', 'canceled'].includes(patch.status) && patch.status !== existing?.status) {
      const m = await methodOf(ctx, merged.method);
      if (m.justification && !String(merged.justification ?? '').trim()) errors.justification = `Write why ${m.label.toLowerCase()} is justified before moving on from planning.`;
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    if (!existing && !merged.buyer_id && req?.user) {
      const actor = actorOf(req);
      if (actor.id) patch.buyer_id = actor.id;
    }
    return patch;
  }

  ctx.defineResource({
    type: PROCUREMENT, table: 'procurements', module: 'procurement', label: 'Solicitation', plural: 'Solicitations',
    path: '/api/procurements', route: '/procurement/solicitations', titleField: 'title',
    ref: { field: 'ref', prefix: 'PRC-' },
    scope: { department: 'department_id' },
    searchable: ['title', 'description', 'justification', 'award_reason', 'notes'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, help: 'What is being bought, for example "Fare collection maintenance services".' },
      description: { label: 'Scope of work', type: 'longtext', personal: false },
      method: { label: 'Method', type: 'lookup', list: 'procurement_method', required: true, help: 'How it is bought: micro-purchase, small purchase, sealed bid, competitive proposals, sole source, cooperative or emergency.' },
      solicitation_type: { label: 'Solicitation', type: 'lookup', list: 'solicitation_type', help: 'Request for proposals, quotes, bids or information; "No solicitation" for a direct purchase.' },
      status: { label: 'Status', type: 'lookup', list: 'procurement_status', default: 'planning' },
      estimated_value: { label: 'Estimated value', type: 'currency' },
      independent_estimate: { label: 'Independent cost estimate', type: 'currency', help: 'The organization\'s own estimate, made before offers are opened.' },
      independent_estimate_on: { label: 'Estimate made on', type: 'date' },
      funding_award_id: { label: 'Funding source', type: 'ref', to: 'funding_award', help: 'The grant or other funding award that pays for it, if any.' },
      department_id: { label: 'Requesting department', type: 'ref', to: 'department' },
      buyer_id: { label: 'Buyer', type: 'user', help: 'The person in procurement who runs it.' },
      document_id: { label: 'Solicitation document', type: 'ref', to: 'policy', help: 'The solicitation in the document library, when it is kept there.' },
      issued_on: { label: 'Issued on', type: 'date' },
      questions_due_on: { label: 'Questions due', type: 'date' },
      proposals_due_at: { label: 'Offers due', type: 'datetime', help: 'When proposals, bids or quotes are due.' },
      award_planned_on: { label: 'Planned award', type: 'date' },
      justification: { label: 'Sole-source or emergency justification', type: 'longtext', personal: false },
      awarded_offer_id: { label: 'Awarded offer', type: 'ref', to: OFFER, readOnly: true },
      awarded_on: { label: 'Awarded on', type: 'date', readOnly: true },
      awarded_by: { label: 'Award recorded by', type: 'user', readOnly: true },
      awarded_by_name: { label: 'Award recorded by (name)', type: 'text', readOnly: true, personal: true },
      award_amount: { label: 'Award amount', type: 'currency', readOnly: true },
      award_reason: { label: 'Why this offer', type: 'longtext', readOnly: true, personal: false },
      contract_id: { label: 'Resulting contract', type: 'ref', to: 'contract', help: 'The contract made from the award (vendors and contracts).' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => procurementRules(req, null, data),
      beforeUpdate: (req, existing, patch) => procurementRules(req, existing, patch),
    },
  });

  async function offerRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (!merged.vendor_id && !String(merged.bidder_name ?? '').trim()) errors.bidder_name = 'Choose the vendor or write the bidder\'s name.';
    if (merged.amount !== null && merged.amount !== undefined && merged.amount !== '' && Number(merged.amount) < 0) errors.amount = 'Give an amount of zero or more.';
    if (Object.keys(errors).length) invalid(ctx, errors);
    // The vendor's name is kept as the bidder's name, so the offer reads the same if the vendor is renamed later.
    if (patch.vendor_id && patch.vendor_id !== existing?.vendor_id && ctx.resources.get('vendor')) {
      const v = await db.one<Row>('select name from vendors where id = $1', [patch.vendor_id]);
      if (v && !String(patch.bidder_name ?? '').trim()) patch.bidder_name = v.name;
    }
    if (!isDataLoad(req)) {
      const proc = await db.one<Row>('select status, awarded_on from procurements where id = $1 and deleted_at is null', [merged.procurement_id]);
      if (!proc) invalid(ctx, { procurement_id: 'Solicitation not found.' });
      if (!existing && (proc!.awarded_on || ['canceled', 'closed'].includes(proc!.status))) {
        invalid(ctx, { procurement_id: 'This solicitation is awarded or closed: no more offers can be recorded.' });
      }
      if (existing && patch.procurement_id && patch.procurement_id !== existing.procurement_id) invalid(ctx, { procurement_id: 'An offer stays with the solicitation it was made to.' });
    }
    if (!existing && !merged.received_at) patch.received_at = new Date().toISOString();
    return patch;
  }

  ctx.defineResource({
    type: OFFER, table: 'procurement_offers', module: 'procurement', label: 'Offer', plural: 'Offers',
    path: '/api/procurement-offers', route: '/procurement/offers', titleField: 'bidder_name',
    ref: { field: 'ref', prefix: 'OFR-' },
    // Offers and their prices are read by procurement staff and the evaluation committee until the award;
    // after it, by everyone who may view procurement. Figures still count them, without their details.
    rowRule: {
      where: (user, col) => (isStaff(ctx, user) ? 'true' : `(${awardedSql(col('procurement_id'))} or ${evaluatorSql(col('procurement_id'), user.id)})`),
      figures: 'mask',
      hidden: (col) => `not ${awardedSql(col('procurement_id'))}`,
    },
    searchable: ['bidder_name', 'notes'],
    defaultSort: { field: 'received_at', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      procurement_id: { label: 'Solicitation', type: 'ref', to: PROCUREMENT, required: true },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', help: 'The bidder as a vendor record; or leave empty and write the name.' },
      bidder_name: { label: 'Bidder', type: 'text', personal: false, help: 'The bidder\'s name when it is not a vendor record (filled in from the vendor otherwise).' },
      received_at: { label: 'Received', type: 'datetime' },
      amount: { label: 'Price offered', type: 'currency' },
      status: { label: 'Status', type: 'lookup', list: 'offer_status', default: 'received' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (req, data) => offerRules(req, null, data),
      beforeUpdate: (req, existing, patch) => offerRules(req, existing, patch),
    },
  });
}

/** One offer's place in the evaluation. */
export interface RankedOffer {
  offer_id: string; ref: string | null; bidder: string; amount: number | null; status: string | null;
  /** Weighted score out of 100 (scored methods), from the average of the evaluators' scores per criterion. */
  total: number | null;
  /** Average score per criterion id. */
  by_criterion: Record<string, number | null>;
  /** Evaluators who scored every criterion of this offer. */
  complete_by: number;
  rank: number | null;
  late: boolean;
}

/**
 * The ranked result of a procurement: for a scored method, by weighted score (each criterion's average
 * score over its top score, times its weight, out of 100); for a price method, the lowest price of the
 * responsive offers first. Withdrawn and nonresponsive offers are not ranked.
 */
export async function rankOffers(ctx: ModuleContext, proc: Row): Promise<{ evaluation: 'scored' | 'price' | 'none'; offers: RankedOffer[]; criteria: Row[] }> {
  const { db } = ctx;
  const m = await methodOf(ctx, proc.method);
  const criteria = await db.query<Row>('select * from procurement_criteria where procurement_id = $1 order by sort, created_at', [proc.id]);
  const offers = await db.query<Row>(
    `select id, ref, bidder_name, amount, status, received_at from procurement_offers where procurement_id = $1 and deleted_at is null order by received_at, ref`, [proc.id]);
  const scores = await db.query<Row>('select offer_id, criterion_id, evaluator_id, score from procurement_scores where procurement_id = $1', [proc.id]);
  const weightSum = criteria.reduce((s, c) => s + num(c.weight), 0);
  const due = proc.proposals_due_at ? new Date(proc.proposals_due_at).getTime() : null;
  const out: RankedOffer[] = offers.map((o) => {
    const mine = scores.filter((s) => s.offer_id === o.id);
    const by: Record<string, number | null> = {};
    let total = 0;
    let any = false;
    for (const c of criteria) {
      const s = mine.filter((x) => x.criterion_id === c.id).map((x) => num(x.score));
      const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
      by[c.id] = avg === null ? null : Math.round(avg * 100) / 100;
      if (avg !== null) { any = true; total += (avg / num(c.max_score)) * num(c.weight); }
    }
    const evaluators = new Set(mine.map((x) => x.evaluator_id));
    let complete = 0;
    for (const e of evaluators) if (criteria.every((c) => mine.some((x) => x.evaluator_id === e && x.criterion_id === c.id))) complete += 1;
    return {
      offer_id: o.id, ref: o.ref ?? null, bidder: o.bidder_name ?? '', amount: o.amount === null ? null : num(o.amount), status: o.status ?? null,
      total: any && weightSum > 0 ? Math.round((total / weightSum) * 10000) / 100 : null,
      by_criterion: by, complete_by: complete, rank: null,
      late: Boolean(due && o.received_at && new Date(o.received_at).getTime() > due),
    };
  });
  const rankable = out.filter((o) => !['withdrawn', 'nonresponsive'].includes(String(o.status)));
  const sorted = m.evaluation === 'price'
    ? rankable.filter((o) => o.amount !== null).sort((a, b) => a.amount! - b.amount!)
    : rankable.filter((o) => o.total !== null).sort((a, b) => b.total! - a.total!);
  sorted.forEach((o, i) => { o.rank = i > 0 && (m.evaluation === 'price' ? sorted[i - 1].amount === o.amount : sorted[i - 1].total === o.total) ? sorted[i - 1].rank : i + 1; });
  return { evaluation: m.evaluation, offers: out, criteria };
}
