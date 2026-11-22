// Shared pieces of the OT pages: the section tabs, the "below target" chip and the panels other
// modules offer (actions, controls), loaded by file name so the OT pages build without them.
import { lazy, Suspense, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, StatusChip, Tabs } from '../../core';

const SECTIONS = [
  { key: 'overview', label: 'Overview', path: '/ot' },
  { key: 'zones', label: 'Security zones', path: '/ot/zones' },
  { key: 'conduits', label: 'Conduits', path: '/ot/conduits' },
] as const;

export function OtTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="OT security sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/ot')} />
  );
}

/** Below target: the achieved level is lower than the target, or the zone has not been assessed. */
export function TargetChip({ below, assessed = true }: { below: boolean; assessed?: boolean }) {
  if (!below) return <StatusChip color="green" label="At target" />;
  return <StatusChip color="orange" label={assessed ? 'Below target' : 'Not assessed'} />;
}

// The action tracker (risks module) and the controls covering a record (controls module).
interface ActionsPanelProps { sourceType: string; sourceId: string; source?: string }
const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<ActionsPanelProps> }>('../risks/ActionsPanel.tsx');
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;
export const actionsInBuild = !!LazyActions;

export function OtActions(props: ActionsPanelProps) {
  if (!LazyActions) return null;
  return <Suspense fallback={<Loading lines={3} />}><LazyActions {...props} /></Suspense>;
}

interface ControlsPanelProps { recordType: string; recordId: string }
const controlLoaders = import.meta.glob<{ ControlsPanel: ComponentType<ControlsPanelProps> }>('../controls/ControlsPanel.tsx');
const loadControls = Object.values(controlLoaders)[0];
const LazyControls = loadControls ? lazy(() => loadControls().then((m) => ({ default: m.ControlsPanel }))) : null;
export const controlsInBuild = !!LazyControls;

export function OtControls(props: ControlsPanelProps) {
  if (!LazyControls) return null;
  return <Suspense fallback={<Loading lines={2} />}><LazyControls {...props} /></Suspense>;
}
