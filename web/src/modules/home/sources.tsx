// The summary endpoints the dashboard widgets share. Each is requested at most once, and only
// when a widget on screen reads it and the person may view the record type behind it.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fromZonedInput, qs, todayInZone, useFetch } from '../../core';
import type { FetchState } from '../../core';
import type { SourceData, SourceKey, WidgetCtx } from './types';

/** The record type that must be visible to the person before a source may be requested. */
export const SOURCE_TYPE: Record<SourceKey, string> = {
  tickets: 'ticket',
  actions: 'action',
  clocks: 'security_incident',
  renewals: 'contract',
  risks: 'risk',
  portfolio: 'project',
  changes: 'change',
  vulnerabilities: 'vulnerability',
  training: 'course',
};

export const sourceAllowed = (ctx: WidgetCtx, key: SourceKey): boolean => ctx.sees(SOURCE_TYPE[key]);

/** Monday to Monday around today, in the organization's time zone. */
export function thisWeek(): { from: string; to: string; fromDay: string; toDay: string } {
  const shift = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const today = todayInZone();
  const fromDay = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const toDay = shift(fromDay, 7);
  return { from: fromZonedInput(`${fromDay}T00:00`), to: fromZonedInput(`${toDay}T00:00`), fromDay, toDay };
}

type Sources = { [K in SourceKey]: FetchState<SourceData[K]> };

const SourcesContext = createContext<Sources | null>(null);

export function SourcesProvider({ ctx, needed, children }: { ctx: WidgetCtx; needed: ReadonlySet<SourceKey>; children: ReactNode }) {
  const week = useMemo(() => thisWeek(), []);
  const url = (key: SourceKey, path: string) => (needed.has(key) && sourceAllowed(ctx, key) ? path : null);
  const value: Sources = {
    tickets: useFetch(url('tickets', '/api/tickets/metrics')),
    actions: useFetch(url('actions', '/api/actions/summary')),
    clocks: useFetch(url('clocks', '/api/security-incidents/clocks')),
    renewals: useFetch(url('renewals', '/api/contracts/renewals')),
    risks: useFetch(url('risks', '/api/risks/summary')),
    portfolio: useFetch(url('portfolio', '/api/projects/portfolio')),
    changes: useFetch(url('changes', `/api/changes/overview${qs({ week_from: week.from, week_to: week.to })}`)),
    vulnerabilities: useFetch(url('vulnerabilities', '/api/vulnerabilities/summary')),
    training: useFetch(url('training', '/api/training/summary')),
  };
  return (
    <CtxContext.Provider value={ctx}>
      <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>
    </CtxContext.Provider>
  );
}

const CtxContext = createContext<WidgetCtx | null>(null);

/** What the signed-in person may see, for widgets that show parts of several areas. */
export function useWidgetCtx(): WidgetCtx {
  const ctx = useContext(CtxContext);
  if (!ctx) throw new Error('useWidgetCtx must be used inside SourcesProvider');
  return ctx;
}

/** One shared endpoint's state. `data`, `error` and `loading` are all empty when it was not requested. */
export function useSource<K extends SourceKey>(key: K): FetchState<SourceData[K]> {
  const sources = useContext(SourcesContext);
  if (!sources) throw new Error('useSource must be used inside SourcesProvider');
  return sources[key];
}
