// Shared pieces of the control library pages: section tabs, the coverage state chip and the
// corrective action plan panel loader.
import { lazy, Suspense, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, StatusChip, Tabs } from '../../core';
import type { ColorName } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/controls/dashboard' },
  { key: 'controls', label: 'Controls', path: '/controls' },
  { key: 'tests', label: 'Tests', path: '/controls/tests' },
  { key: 'coverage', label: 'Coverage', path: '/controls/coverage' },
] as const;

export function ControlsTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Control library sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/controls')} />
  );
}

/** A control's state in coverage terms, worst first. */
export type CoverState = 'ineffective' | 'overdue' | 'untested' | 'partly_effective' | 'effective';

export const STATE_INFO: Record<CoverState, { label: string; color: ColorName; hint: string }> = {
  ineffective: { label: 'Ineffective', color: 'red', hint: 'Its newest reviewed test found it ineffective.' },
  overdue: { label: 'Test overdue', color: 'orange', hint: 'Its next test date has passed.' },
  untested: { label: 'Not tested', color: 'gray', hint: 'No reviewed test of its operation yet.' },
  partly_effective: { label: 'Partly effective', color: 'amber', hint: 'Its newest reviewed test found exceptions.' },
  effective: { label: 'Effective', color: 'green', hint: 'Its newest reviewed test found it effective, and it is not overdue.' },
};
export const STATE_ORDER: CoverState[] = ['ineffective', 'overdue', 'untested', 'partly_effective', 'effective'];

export function StateChip({ state }: { state: CoverState | null | undefined }) {
  if (!state) return <span className="muted">Retired</span>;
  const s = STATE_INFO[state];
  return <span title={s.hint}><StatusChip color={s.color} label={s.label} /></span>;
}

// Corrective action plans live in the risks module; load its panel only when that file is in the build.
interface CapPanelProps { sourceType: string; sourceId: string; source?: string }
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<CapPanelProps> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;

/** The corrective action plans raised on a record, or nothing when the build has no plans. */
export function ControlCaps(props: CapPanelProps) {
  if (!LazyCaps) return null;
  return <Suspense fallback={<Loading lines={2} />}><LazyCaps {...props} /></Suspense>;
}
export const capsInBuild = !!LazyCaps;
