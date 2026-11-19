import { fromZonedInput, todayInZone, toZonedInput } from '../../core';
import { ANY, type ApprovalRule, type Questionnaire } from './types';

// ---------- calendar days, in the organization's time zone ----------

/** The calendar day (YYYY-MM-DD) an instant falls on. */
export const dayOf = (iso: string | Date): string => toZonedInput(iso).slice(0, 10);
/** Minutes after midnight of an instant. */
export const minuteOf = (iso: string | Date): number => {
  const [h, m] = toZonedInput(iso).slice(11).split(':').map(Number);
  return h * 60 + m;
};
/** The instant a calendar day starts. */
export const startOfDay = (day: string): string => fromZonedInput(`${day}T00:00`);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export const weekdayOf = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
export const weekStart = (day: string): string => addDays(day, -weekdayOf(day));
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

export function addMonths(day: string, n: number): string {
  const d = new Date(`${monthStart(day)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const monthLabel = (day: string): string => monthFmt.format(new Date(`${day}T00:00:00Z`));
export const dayLabel = (day: string): string => dayFmt.format(new Date(`${day}T00:00:00Z`));
/** "14:05" */
export const timeLabel = (iso: string): string => toZonedInput(iso).slice(11);

/** This week, Monday to Monday, as instants. */
export function thisWeek(): { from: string; to: string; fromDay: string; toDay: string } {
  const fromDay = weekStart(todayInZone());
  const toDay = addDays(fromDay, 7);
  return { from: startOfDay(fromDay), to: startOfDay(toDay), fromDay, toDay };
}

// ---------- the same rules the server applies, for live previews ----------

export interface RiskPreview { score: number | null; level: string | null; complete: boolean; answered: number }

export function computeRisk(answers: Record<string, string>, q: Questionnaire): RiskPreview {
  let total = 0;
  let max = 0;
  let answered = 0;
  for (const question of q.questions) {
    const weight = Number(question.weight) > 0 ? Number(question.weight) : 0;
    const top = Math.max(0, ...question.options.map((o) => Number(o.score) || 0));
    const picked = question.options.find((o) => o.value === answers[question.key]);
    if (!picked) continue;
    answered += 1;
    total += weight * (Number(picked.score) || 0);
    max += weight * top;
  }
  if (!answered) return { score: null, level: null, complete: false, answered };
  const score = max > 0 ? Math.round((total / max) * 100) : 0;
  const complete = answered === q.questions.length;
  const bands = [...q.bands].sort((a, b) => a.upTo - b.upTo);
  const level = complete ? (bands.find((b) => score <= b.upTo) ?? bands[bands.length - 1])?.level ?? null : null;
  return { score, level, complete, answered };
}

export function matchRule(rules: ApprovalRule[], changeType: string, riskLevel: string | null): ApprovalRule | undefined {
  const rule = rules.find((r) => r.change_type === changeType && r.risk_level === riskLevel)
    ?? rules.find((r) => r.change_type === changeType && r.risk_level === ANY)
    ?? rules.find((r) => r.change_type === ANY && r.risk_level === riskLevel)
    ?? rules.find((r) => r.change_type === ANY && r.risk_level === ANY);
  if (rule && changeType === 'emergency') return { ...rule, approvals: Math.min(rule.approvals, 1), pir_required: true };
  return rule;
}

/** The main line of the lifecycle, for the stepper. Rejected and canceled are shown as a blocked step. */
export const LIFECYCLE = ['draft', 'submitted', 'approved', 'scheduled', 'in_progress', 'completed', 'reviewed', 'closed'];

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
