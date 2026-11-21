// Shared pieces of the safety pages: section tabs, the hazard matrix and the action panel loader.
import { lazy, Suspense, type ComponentType, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Loading, StatusChip, Tabs, useFetch } from '../../core';
import type { ColorName } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/safety' },
  { key: 'events', label: 'Safety events', path: '/safety/events' },
  { key: 'hazards', label: 'Hazard log', path: '/safety/hazards' },
  { key: 'indicators', label: 'Indicators', path: '/safety/indicators' },
  { key: 'exposure', label: 'Exposure', path: '/safety/exposure' },
] as const;

export function SafetyTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Safety sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/safety')} />
  );
}

export interface Level { value: number; label: string; description?: string }
export interface Scale {
  key: string; name: string; likelihood_label: string; impact_label: string;
  likelihood_levels: Level[]; impact_levels: Level[];
  matrix: Record<string, Record<string, string>>;
  ratings: { key: string; label: string; color: string }[];
}

/** The hazard matrix (kept by the risks module). Null while loading or when it is not available. */
export function useHazardScale(): { scale: Scale | null; error: unknown } {
  const { data, error } = useFetch<Scale>('/api/safety/scale');
  return { scale: data ?? null, error };
}

export function RatingChip({ scale, rating }: { scale: Scale | null; rating: string | null | undefined }) {
  if (!rating) return <span className="muted">Not scored</span>;
  const r = scale?.ratings.find((x) => x.key === rating);
  return <StatusChip color={(r?.color ?? 'gray') as ColorName} label={r?.label ?? rating} />;
}

/**
 * The matrix as a grid of buttons: worst likelihood at the top, worst severity on the right. Each
 * cell names its rating in text, so color never carries it alone. With `onPick` the cells choose
 * a likelihood and severity; with `counts` they show how many hazards sit there.
 */
export function HazardMatrix({ scale, value, onPick, counts, label }: {
  scale: Scale;
  value?: { likelihood: number | null; severity: number | null };
  onPick?: (likelihood: number, severity: number) => void;
  counts?: Record<string, number>;
  label: string;
}) {
  const rows = [...scale.likelihood_levels].sort((a, b) => b.value - a.value);
  const cols = [...scale.impact_levels].sort((a, b) => a.value - b.value);
  const rating = (l: number, s: number) => scale.ratings.find((r) => r.key === scale.matrix[String(l)]?.[String(s)]);
  return (
    <div className="sf-matrix" role="group" aria-label={label}>
      <div className="sf-matrix-grid" style={{ gridTemplateColumns: `minmax(5.5rem, auto) repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span className="sf-axis-corner muted">{scale.likelihood_label} ↓ / {scale.impact_label} →</span>
        {cols.map((c) => <span key={c.value} className="sf-col-label" title={c.description}>{c.label}</span>)}
        {rows.map((l) => (
          <div key={l.value} className="sf-row" style={{ display: 'contents' }}>
            <span className="sf-row-label" title={l.description}>{l.label}</span>
            {cols.map((c) => {
              const r = rating(l.value, c.value);
              const chosen = value?.likelihood === l.value && value?.severity === c.value;
              const n = counts?.[`${l.value}.${c.value}`] ?? 0;
              const name = `${l.label} by ${c.label}: ${r?.label ?? 'not rated'}`;
              const style = { '--sf-bg': `var(--c-${r?.color ?? 'gray'}-bg)`, '--sf-fg': `var(--c-${r?.color ?? 'gray'}-fg)` } as CSSProperties;
              return onPick ? (
                <button key={c.value} type="button" className={`sf-cell${chosen ? ' is-chosen' : ''}`} style={style}
                  aria-pressed={chosen} aria-label={name} title={name} onClick={() => onPick(l.value, c.value)}>
                  {r?.label}
                </button>
              ) : (
                <span key={c.value} className={`sf-cell${n ? '' : ' is-empty'}`} style={style} title={name} aria-label={`${name}, ${n} hazard${n === 1 ? '' : 's'}`}>
                  <strong className="sf-cell-n">{n || ''}</strong><span className="sf-cell-r">{r?.label}</span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// The action tracker lives in the risks module; load its panel only when that module is in the build.
const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>('../risks/ActionsPanel.tsx');
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

// Corrective action plans (contract C1) live in the risks module too: shown when that file is in the build.
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;

/** The event's corrective action plans; draws nothing when the panel is not part of this build. */
export function SafetyCaps({ sourceType, sourceId }: { sourceType: string; sourceId: string }) {
  if (!LazyCaps) return null;
  return <Suspense fallback={null}><LazyCaps sourceType={sourceType} sourceId={sourceId} source="safety" /></Suspense>;
}

export function SafetyActions({ sourceType, sourceId }: { sourceType: string; sourceId: string }) {
  if (!LazyActions) return <Card title="Actions"><p className="muted">The action tracker is not part of this installation.</p></Card>;
  return <Suspense fallback={<Loading lines={3} />}><LazyActions sourceType={sourceType} sourceId={sourceId} source="safety" /></Suspense>;
}
