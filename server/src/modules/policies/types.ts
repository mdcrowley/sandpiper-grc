// Document types and their tiers (E43). The list `policy_document_type` is the administrator's to
// edit (Administration > Lists); these are its first values. Meta keys:
//   tier: 1 governing (policy, plan, charter) · 2 standards and programs · 3 procedures, SOPs,
//         rulebook sections, bulletins · 4 work instructions, guidelines, forms · 'X' external · 'R' reference
//   prefix: the number prefix (numbering.ts); review_months: the review cycle;
//   ack_default: readers acknowledge by default; plan: a plan (E28); external: a document of external
//   origin; uncontrolled: kept for reference only (no approval cycle, no review reminders).
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';

export const DOCUMENT_TYPES: LookupValue[] = [
  { value: 'policy', label: 'Policy', color: 'blue', sort: 10, meta: { tier: 1, prefix: 'POL', review_months: 24, ack_default: true } },
  { value: 'plan', label: 'Plan', color: 'red', sort: 15, meta: { tier: 1, prefix: 'PLN', plan: true, review_months: 12 } },
  { value: 'charter', label: 'Charter or bylaws', color: 'purple', sort: 17, meta: { tier: 1, prefix: 'CHR', review_months: 36 } },
  { value: 'standard', label: 'Standard', color: 'green', sort: 20, meta: { tier: 2, prefix: 'STD', review_months: 36 } },
  { value: 'program', label: 'Program or manual', color: 'teal', sort: 25, meta: { tier: 2, prefix: 'PRG', review_months: 24 } },
  { value: 'procedure', label: 'Procedure', color: 'teal', sort: 30, meta: { tier: 3, prefix: 'PRC', review_months: 24 } },
  { value: 'sop', label: 'Standard operating procedure', color: 'blue', sort: 35, meta: { tier: 3, prefix: 'SOP', review_months: 24 } },
  { value: 'rulebook_section', label: 'Rulebook section', color: 'purple', sort: 40, meta: { tier: 3, prefix: 'RB', review_months: 12, ack_default: true } },
  { value: 'bulletin', label: 'Bulletin', color: 'amber', sort: 45, meta: { tier: 3, prefix: 'BUL', review_months: 6, ack_default: true } },
  { value: 'work_instruction', label: 'Work instruction', color: 'gray', sort: 50, meta: { tier: 4, prefix: 'WI', review_months: 24 } },
  { value: 'guideline', label: 'Guideline', color: 'gray', sort: 55, meta: { tier: 4, prefix: 'GDL', review_months: 36 } },
  { value: 'form_template', label: 'Form or template', color: 'gray', sort: 60, meta: { tier: 4, prefix: 'FRM', review_months: 36 } },
  { value: 'external', label: 'External document', color: 'orange', sort: 70, meta: { tier: 'X', prefix: 'EXT', review_months: 12, external: true } },
  { value: 'reference', label: 'Reference document', color: 'gray', sort: 80, meta: { tier: 'R', prefix: 'REF', uncontrolled: true } },
];

export interface TypeInfo {
  value: string; label: string;
  /** 1 to 4; external 5, reference 6 (for ordering and the parent rule). */
  tier: number; tierLabel: string;
  reviewMonths: number | null; ackDefault: boolean; plan: boolean; external: boolean; uncontrolled: boolean;
}

export function tierNumber(raw: unknown): number {
  if (raw === 'X') return 5;
  if (raw === 'R') return 6;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : 3;
}

export function infoOf(value: string, v: LookupValue | undefined): TypeInfo {
  const meta = (v?.meta ?? {}) as Row;
  const months = Number(meta.review_months);
  return {
    value, label: v?.label ?? value,
    tier: tierNumber(meta.tier), tierLabel: meta.tier === undefined ? '' : String(meta.tier),
    reviewMonths: Number.isInteger(months) && months > 0 && months <= 120 ? months : null,
    ackDefault: meta.ack_default === true, plan: meta.plan === true || (!v && value === 'plan'),
    external: meta.external === true, uncontrolled: meta.uncontrolled === true,
  };
}

export async function typeInfo(ctx: ModuleContext, value: unknown): Promise<TypeInfo> {
  const key = String(value ?? 'policy');
  return infoOf(key, (await ctx.lookups.values('policy_document_type')).find((x) => x.value === key));
}

export async function typeMap(ctx: ModuleContext): Promise<Map<string, TypeInfo>> {
  return new Map((await ctx.lookups.values('policy_document_type')).map((v) => [v.value, infoOf(v.value, v)]));
}

/** The document's review cycle in months: its own, else its type's; null for none. */
export async function cycleOf(ctx: ModuleContext, policy: Row): Promise<number | null> {
  const own = Number(policy.review_months);
  if (Number.isInteger(own) && own > 0) return own;
  const info = await typeInfo(ctx, policy.document_type);
  return info.uncontrolled ? null : info.reviewMonths;
}
