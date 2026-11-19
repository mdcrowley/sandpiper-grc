// The shared Actions panel (risks module), loaded only when that module is part of the build
// and the `action` record type exists on the server.
import { lazy, Suspense, type ComponentType } from 'react';
import { Loading, useResource } from '../../core';

interface PanelProps { sourceType: string; sourceId: string; source?: string }

const loaders = import.meta.glob<{ ActionsPanel: ComponentType<PanelProps> }>('../risks/ActionsPanel.tsx');
const load = Object.values(loaders)[0];
const Panel = load ? lazy(() => load().then((m) => ({ default: m.ActionsPanel }))) : null;

/** True when follow-up actions can be recorded here. */
export function useHasActions(): boolean {
  return Boolean(useResource('action')) && Panel !== null;
}

export function RecordActions(props: PanelProps) {
  if (!Panel) return null;
  return <Suspense fallback={<Loading lines={3} label="Loading actions" />}><Panel {...props} /></Suspense>;
}
