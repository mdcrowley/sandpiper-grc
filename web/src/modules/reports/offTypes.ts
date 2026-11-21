// Switched-off areas on dashboards (BW-04): an area that is off shows nowhere but its switch, so its
// widgets are left out of a dashboard, and a standard dashboard made only of them is not listed.
import { useMemo } from 'react';
import { useFetch } from '../../core/hooks';
import type { Widget } from './types';

/** The record types of switched-off areas, the same for everyone; undefined while loading. */
export function useOffTypes(): Set<string> | undefined {
  const off = useFetch<{ types: string[] }>('/api/dashboards/switched-off-types');
  return useMemo(() => (off.data ? new Set(off.data.types) : off.error ? new Set<string>() : undefined), [off.data, off.error]);
}

const widgetType = (w: Widget) => (w.config as { spec?: { type?: unknown } } | undefined)?.spec?.type;

/** A widget about a record type of a switched-off area. */
export const widgetOff = (w: Widget, off: Set<string>) => { const t = widgetType(w); return typeof t === 'string' && off.has(t); };

/** Every widget about records is about a switched-off area (text widgets do not count). */
export const dashboardOff = (widgets: Widget[], off: Set<string>) => {
  const typed = widgets.filter((w) => typeof widgetType(w) === 'string');
  return typed.length > 0 && typed.every((w) => widgetOff(w, off));
};
