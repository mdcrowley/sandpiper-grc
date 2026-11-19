import { RingProgress } from '@mantine/core';
import type { ColorName } from '../../core';
import type { ScaleValue, Tally } from './types';
import { initials } from './types';

/**
 * One horizontal bar split by status, widths in proportion to the counts. Each segment
 * carries its own hover text; the counts or the legend name the colors, so meaning is never
 * carried by color alone.
 */
export function StatusBar({ tally, scale, label, showCounts, thick }: {
  tally: Tally; scale: ScaleValue[]; label: string; showCounts?: boolean; thick?: boolean;
}) {
  const parts = scale.map((s) => ({ ...s, count: tally.counts[s.value] ?? 0 })).filter((p) => p.count > 0);
  const summary = scale.map((s) => `${s.label}: ${tally.counts[s.value] ?? 0}`).join(', ');
  return (
    <div className="fw-bar-wrap">
      <div className={thick ? 'fw-bar fw-bar-thick' : 'fw-bar'} role="img" aria-label={`${label}. ${summary}`}>
        {tally.total === 0 && <span className="fw-bar-empty" />}
        {parts.map((p) => (
          <span
            key={p.value}
            className="fw-bar-seg"
            style={{ flexGrow: p.count, background: `var(--c-${p.color}-solid)` }}
            title={`${p.label}: ${p.count} of ${tally.total}`}
          />
        ))}
      </div>
      {showCounts && (
        <ul className="fw-bar-counts" aria-hidden="true">
          {parts.length ? parts.map((p) => (
            <li key={p.value}><span className="fw-swatch" style={{ background: `var(--c-${p.color}-solid)` }} />{p.count} {p.label.toLowerCase()}</li>
          )) : <li>No outcomes</li>}
        </ul>
      )}
    </div>
  );
}

export function StatusLegend({ scale }: { scale: ScaleValue[] }) {
  return (
    <ul className="fw-legend" aria-label="Status colors">
      {scale.map((s) => (
        <li key={s.value}>
          <span className="fw-swatch" style={{ background: `var(--c-${s.color}-solid)` }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** A ring showing the share of outcomes at or above the target status, with the figure in the middle. */
export function TargetRing({ tally, size = 64, color = 'green', label }: {
  tally: Tally; size?: number; color?: ColorName; label: string;
}) {
  const pct = tally.total ? Math.round((tally.atTarget / tally.total) * 100) : 0;
  return (
    <div className="fw-ring" role="img" aria-label={`${label}: ${tally.atTarget} of ${tally.total} at target (${pct}%)`}>
      <RingProgress
        size={size}
        thickness={Math.max(5, Math.round(size / 10))}
        roundCaps
        rootColor="var(--fw-ring-track)"
        sections={pct > 0 ? [{ value: pct, color: `var(--c-${color}-solid)` }] : []}
        label={<span className="fw-ring-label" style={{ fontSize: size >= 96 ? 'var(--fs-xl)' : size >= 60 ? 'var(--fs-sm)' : 'var(--fs-xs)' }}>{pct}%</span>}
      />
    </div>
  );
}

/** A person as initials in a circle, with the full name on hover. */
export function OwnerAvatar({ name, size = 22 }: { name: string | null; size?: number }) {
  if (!name) return null;
  return (
    <span className="fw-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name} role="img" aria-label={`Owner: ${name}`}>
      {initials(name)}
    </span>
  );
}
