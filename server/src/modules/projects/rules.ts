// Pure rules for tiers and portfolio scoring, and the defaults an administrator can change.

export interface TierThresholds {
  /** Budgets below this are Tier 3. */
  tier3Below: number;
  /** Budgets above this are Tier 1. Anything in between (inclusive) is Tier 2. */
  tier1Above: number;
}

/** Example defaults only (formal procurement from 50,000, governing-body approval above 100,000): an administrator edits them. */
export const DEFAULT_TIERS: TierThresholds = { tier3Below: 50000, tier1Above: 100000 };

export type Tier = 'tier_1' | 'tier_2' | 'tier_3';

export interface TierInput {
  budget?: number | null;
  touches_payment?: boolean | null;
  touches_personal_data?: boolean | null;
  touches_operational_systems?: boolean | null;
}

export function computeTier(p: TierInput, t: TierThresholds = DEFAULT_TIERS): Tier {
  if (p.touches_payment || p.touches_personal_data || p.touches_operational_systems) return 'tier_1';
  const budget = Number(p.budget ?? 0) || 0;
  if (budget > t.tier1Above) return 'tier_1';
  if (budget >= t.tier3Below) return 'tier_2';
  return 'tier_3';
}

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  description?: string;
}

/** Each criterion is scored from 0 to MAX_SCORE. */
export const MAX_SCORE = 5;

export const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'strategic_alignment', label: 'Strategic alignment', weight: 25, description: 'How directly it supports the strategic plan and the organisation\'s goals.' },
  { key: 'risk_reduction', label: 'Risk and compliance', weight: 25, description: 'How much safety, security, legal or audit risk it removes.' },
  { key: 'customer_benefit', label: 'Benefit to customers and staff', weight: 20, description: 'How many people benefit and by how much.' },
  { key: 'financial_return', label: 'Financial return', weight: 15, description: 'Savings, avoided cost or outside funding.' },
  { key: 'readiness', label: 'Readiness to deliver', weight: 15, description: 'Clear scope, available people and a realistic plan.' },
];

export const DEFAULT_WIP_LIMIT = 3;

/**
 * Weighted score from 0 to 100, or null when nothing has been scored.
 * Criteria without a score count as zero; keys that are no longer criteria are ignored.
 */
export function computeScore(scoring: Record<string, unknown> | null | undefined, criteria: Criterion[]): number | null {
  if (!scoring || typeof scoring !== 'object') return null;
  let totalWeight = 0;
  let sum = 0;
  let scored = 0;
  for (const c of criteria) {
    const weight = Number(c.weight) || 0;
    if (weight <= 0) continue;
    totalWeight += weight;
    const raw = (scoring as Record<string, unknown>)[c.key];
    if (raw === null || raw === undefined || raw === '') continue;
    const s = Math.min(MAX_SCORE, Math.max(0, Number(raw) || 0));
    scored += 1;
    sum += weight * (s / MAX_SCORE);
  }
  if (!scored || !totalWeight) return null;
  return Math.round((sum / totalWeight) * 1000) / 10;
}

const RAG_RANK: Record<string, number> = { red: 0, amber: 1, green: 2 };
export const RAG_VALUES = ['red', 'amber', 'green'];

/** Direction of travel between two ratings (previous → latest). */
export function ragTrend(latest: string | null | undefined, previous: string | null | undefined): 'improving' | 'steady' | 'worsening' | null {
  if (!latest || !previous || !(latest in RAG_RANK) || !(previous in RAG_RANK)) return null;
  const d = RAG_RANK[latest] - RAG_RANK[previous];
  return d > 0 ? 'improving' : d < 0 ? 'worsening' : 'steady';
}

// ---------- gate templates ----------

export interface GateTemplate {
  key: string;
  name: string;
  from: string;
  to: string;
  checklist: string[];
  documents: string[];
  approvers: Record<Tier, string[]>;
}

const CIO = 'Chief Information Officer';
const CFO = 'Chief Financial Officer';
const CEO = 'Chief Executive Officer';
const GOVERNING_BODY = 'Governing body';
const SPONSOR = 'Project sponsor';

export const DEFAULT_GATES: GateTemplate[] = [
  {
    key: 'intake', name: 'Intake approval', from: 'idea', to: 'initiate',
    checklist: [
      'Request form complete, with the problem and expected benefit stated',
      'Sponsor named and supportive',
      'Rough cost and tier estimated',
      'Checked against existing systems and projects for overlap',
    ],
    documents: ['Project request'],
    approvers: { tier_3: [CIO], tier_2: [CIO], tier_1: [CIO, SPONSOR] },
  },
  {
    key: 'charter', name: 'Charter approval', from: 'initiate', to: 'plan',
    checklist: [
      'Charter written: scope, objectives, out of scope',
      'Project manager and system owner assigned',
      'Payment, personal data and operational impact flags reviewed',
      'Funding source identified',
    ],
    documents: ['Project charter'],
    approvers: { tier_3: [CIO], tier_2: [CIO, SPONSOR], tier_1: [CIO, SPONSOR, CFO] },
  },
  {
    key: 'plan', name: 'Plan and budget approval', from: 'plan', to: 'procure',
    checklist: [
      'Requirements agreed with the system owner, including security requirements',
      'Budget and schedule baselined, with milestones',
      'Procurement method confirmed against the procurement manual',
      'Project risks recorded and owners assigned',
    ],
    documents: ['Project plan', 'Budget', 'Requirements'],
    approvers: { tier_3: [CIO], tier_2: [CIO, CFO], tier_1: [CIO, CFO, CEO, GOVERNING_BODY] },
  },
  {
    key: 'award', name: 'Contract award', from: 'procure', to: 'deliver',
    checklist: [
      'Procurement completed and documented',
      'Vendor security review complete',
      'Contract includes the required security and data terms',
      'Contract signed and recorded in the contract register',
    ],
    documents: ['Evaluation summary', 'Signed contract'],
    approvers: { tier_3: [CIO], tier_2: [CIO, CFO], tier_1: [CIO, CFO, CEO, GOVERNING_BODY] },
  },
  {
    key: 'go_live', name: 'Go-live', from: 'deliver', to: 'close',
    checklist: [
      'Acceptance tests signed',
      'Security review complete, with multi-factor sign-in and roles configured',
      'Payment and personal data impact assessed',
      'Added to the system inventory and vendor register',
      'Backups configured and one restore tested',
      'Monitoring in place',
      'Support notes with the service desk',
      'Users trained',
      'Retirement of the old system planned',
      'Change record approved',
    ],
    documents: ['Signed acceptance test results', 'Security review', 'Support notes'],
    approvers: { tier_3: [CIO, 'System owner'], tier_2: [CIO, 'System owner', SPONSOR], tier_1: [CIO, 'System owner', SPONSOR, CEO] },
  },
];
