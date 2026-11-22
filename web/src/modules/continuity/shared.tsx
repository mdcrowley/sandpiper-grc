// Shared pieces of the continuity pages: section tabs, hours as words, and the action and
// corrective-action-plan panels loaded from the risks module when it is in the build.
import { lazy, Suspense, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Loading, Tabs } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Overview', path: '/continuity' },
  { key: 'processes', label: 'Processes', path: '/continuity/processes' },
  { key: 'gaps', label: 'Gap report', path: '/continuity/gaps' },
  { key: 'plans', label: 'Plans', path: '/continuity/plans' },
  { key: 'activations', label: 'Activations', path: '/continuity/activations' },
] as const;

export function ContinuityTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Business continuity sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/continuity')} />
  );
}

/** "4 hours", "1.5 days", "Not set". */
export function hoursText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Not set';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Not set';
  if (n >= 48 && n % 24 === 0) return `${n / 24} days`;
  return `${n} hour${n === 1 ? '' : 's'}`;
}

export const PHASES = [
  { value: 'activate', label: 'Activate' },
  { value: 'respond', label: 'Respond' },
  { value: 'recover', label: 'Recover' },
  { value: 'stand_down', label: 'Stand down' },
];

// Corrective action plans live in the risks module; load the panel only when it is in the build.
interface CapPanelProps { sourceType: string; sourceId: string; source?: string }
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<CapPanelProps> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;

export function AfterActionPlans({ activationId }: { activationId: string }) {
  if (!LazyCaps) return <Card title="Corrective action plans"><p className="muted">Corrective action plans are not part of this installation.</p></Card>;
  return <Suspense fallback={<Loading lines={3} />}><LazyCaps sourceType="emergency_activation" sourceId={activationId} source="continuity" /></Suspense>;
}
