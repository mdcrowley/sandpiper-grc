// The shared Actions panel, loaded only when the risks module is part of the build and the
// server has the `action` record type. Follow-ups raised from a review appear here too.
import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { Loading, useResource } from '../../core';

const loaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>(
  '../risks/ActionsPanel.tsx',
);
const load = Object.values(loaders)[0];
const LazyActions = load ? lazy(() => load().then((m) => ({ default: m.ActionsPanel }))) : null;

export function useActionsAvailable(): boolean {
  return Boolean(useResource('action')) && LazyActions !== null;
}

export function ActionsTab({ sourceId }: { sourceId: string }) {
  if (!LazyActions) return null;
  return (
    <Suspense fallback={<Loading lines={3} label="Loading actions" />}>
      <LazyActions sourceType="change" sourceId={sourceId} source="change" />
    </Suspense>
  );
}
