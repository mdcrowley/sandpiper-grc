// Pieces of the report builder: choosing what to report on, the field list, the chart chooser,
// sharing controls and the undo history.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState, Icon, MultiSelect, NumberField, Select, TextField, cx, useFetch } from '../../core';
import type { FieldType } from '../../core';
import { chartFit } from './charts';
import type { CatalogField, CatalogType, ChartKind, ChartSpec, ReportResult, Sharing } from './types';

// ---------- undo ----------

export function useUndo<T>(initial: T) {
  const [h, setH] = useState<{ past: T[]; now: T; future: T[] }>({ past: [], now: initial, future: [] });
  const set = useCallback((next: T | ((prev: T) => T)) => setH((s) => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(s.now) : next;
    return JSON.stringify(value) === JSON.stringify(s.now) ? s : { past: [...s.past.slice(-49), s.now], now: value, future: [] };
  }), []);
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), now: s.past[s.past.length - 1], future: [s.now, ...s.future] } : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1) } : s)), []);
  const reset = useCallback((value: T) => setH({ past: [], now: value, future: [] }), []);
  // Ctrl+Z / Ctrl+Y, except while typing in a box (where they undo the typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!(e.ctrlKey || e.metaKey) || el?.closest('input, textarea, [contenteditable=true]')) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  return { value: h.now, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0, dirty: h.past.length > 0 };
}

// ---------- record type ----------

export function TypePicker({ types, onPick, current }: { types: CatalogType[]; onPick: (t: CatalogType) => void; current?: string }) {
  const [q, setQ] = useState('');
  const shown = types.filter((t) => `${t.plural} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="rp-types">
      <TextField label="Search" hideLabel type="search" value={q} onChange={setQ} placeholder="Search: tickets, contracts, risks…" autoFocus leftSection={<Icon name="search" size={16} />} />
      {shown.length === 0
        ? <EmptyState icon="search" title="Nothing matches" message="Try a different word. You can only report on the kinds of record your role lets you see." />
        : (
          <ul className="rp-type-grid">
            {shown.map((t) => (
              <li key={t.type}>
                <button type="button" className={cx('rp-type', t.type === current && 'is-current')} onClick={() => onPick(t)}>
                  <span className="rp-type-name">{t.plural}{t.restricted && <Icon name="lock" size={14} label="Restricted records" />}</span>
                  <span className="rp-type-desc">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ---------- field list ----------

const TYPE_WORD: Record<FieldType, string> = {
  text: 'text', longtext: 'long text', number: 'number', currency: 'money', date: 'date', datetime: 'date and time',
  boolean: 'yes / no', lookup: 'choice', user: 'person', ref: 'link', json: 'details',
};

export function FieldList({ type, chosen, onToggle, onFilter, verb }: {
  type: CatalogType; chosen: string[]; onToggle: (f: CatalogField) => void; onFilter: (f: CatalogField) => void; verb: string;
}) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const match = type.fields.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));
    const out = new Map<string, CatalogField[]>();
    for (const f of match) {
      const k = f.via ? `From ${f.via.toLowerCase()}` : f.custom ? 'Added by your organization' : type.label;
      out.set(k, [...(out.get(k) ?? []), f]);
    }
    return [...out];
  }, [type, q]);
  return (
    <div className="rp-fields">
      <TextField label="Find a field" hideLabel type="search" value={q} onChange={setQ} placeholder={`Find a field (${type.fields.length})`} leftSection={<Icon name="search" size={16} />} />
      <div className="rp-field-scroll">
        {groups.length === 0 && <p className="rp-empty-hint">No field has that name.</p>}
        {groups.map(([name, fields]) => (
          <div key={name}>
            <p className="rp-field-group">{name}</p>
            <ul>
              {fields.map((f) => {
                const on = chosen.includes(f.path);
                return (
                  <li key={f.path} className={cx('rp-field', on && 'is-on')}>
                    <button type="button" className="rp-field-main" aria-pressed={on} onClick={() => onToggle(f)} title={on ? `Remove ${f.label}` : `${verb} ${f.label}`}>
                      <Icon name={on ? 'check' : 'plus'} size={14} />
                      <span className="truncate">{f.via ? f.label.slice(f.via.length + 2) : f.label}</span>
                      <span className="rp-field-type">{TYPE_WORD[f.type]}</span>
                    </button>
                    {f.type !== 'json' && (
                      <button type="button" className="rp-field-filter" onClick={() => onFilter(f)} aria-label={`Filter by ${f.label}`} title={`Filter by ${f.label}`}><Icon name="filter" size={14} /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- chart chooser ----------

const G = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 32 24" width="32" height="24" aria-hidden="true" fill="currentColor">{children}</svg>;
export const CHART_KINDS: { kind: ChartKind; label: string; hint: string; glyph: ReactNode }[] = [
  { kind: 'table', label: 'Table', hint: 'The figures in rows and columns.', glyph: <G><rect x="3" y="3" width="26" height="4" rx="1" /><rect x="3" y="10" width="26" height="2" rx="1" opacity=".5" /><rect x="3" y="15" width="26" height="2" rx="1" opacity=".5" /><rect x="3" y="20" width="26" height="2" rx="1" opacity=".5" /></G> },
  { kind: 'number', label: 'Number', hint: 'One big figure.', glyph: <G><text x="16" y="19" textAnchor="middle" fontSize="17" fontWeight="700">42</text></G> },
  { kind: 'gauge', label: 'Gauge', hint: 'A figure against a target.', glyph: <G><path d="M5 20a11 11 0 0 1 22 0" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".35" /><path d="M5 20a11 11 0 0 1 14-10.6" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></G> },
  { kind: 'bar', label: 'Bars', hint: 'Compare groups.', glyph: <G><rect x="4" y="12" width="5" height="9" rx="1" /><rect x="11" y="6" width="5" height="15" rx="1" /><rect x="18" y="9" width="5" height="12" rx="1" /><rect x="25" y="15" width="4" height="6" rx="1" /></G> },
  { kind: 'hbar', label: 'Ranked bars', hint: 'Best for long names.', glyph: <G><rect x="4" y="3" width="24" height="4" rx="1" /><rect x="4" y="10" width="16" height="4" rx="1" /><rect x="4" y="17" width="9" height="4" rx="1" /></G> },
  { kind: 'stacked', label: 'Stacked bars', hint: 'Groups split by a second field.', glyph: <G><rect x="5" y="12" width="6" height="9" /><rect x="5" y="6" width="6" height="5" opacity=".5" /><rect x="13" y="9" width="6" height="12" /><rect x="13" y="3" width="6" height="5" opacity=".5" /><rect x="21" y="14" width="6" height="7" /><rect x="21" y="10" width="6" height="3" opacity=".5" /></G> },
  { kind: 'line', label: 'Line', hint: 'Change over time.', glyph: <G><path d="M4 18l7-7 6 4 10-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></G> },
  { kind: 'area', label: 'Area', hint: 'Change over time, filled.', glyph: <G><path d="M4 18l7-7 6 4 10-10v16H4z" opacity=".35" /><path d="M4 18l7-7 6 4 10-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" /></G> },
  { kind: 'donut', label: 'Doughnut', hint: 'Shares of a whole.', glyph: <G><circle cx="16" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="5" opacity=".35" /><path d="M16 4a8 8 0 0 1 7.6 10.5" fill="none" stroke="currentColor" strokeWidth="5" /></G> },
  { kind: 'pie', label: 'Pie', hint: 'Shares of a whole.', glyph: <G><circle cx="16" cy="12" r="10" opacity=".35" /><path d="M16 12V2a10 10 0 0 1 9.5 13.1z" /></G> },
  { kind: 'heatmap', label: 'Heat map', hint: 'Two fields: where the numbers concentrate.', glyph: <G><rect x="4" y="3" width="7" height="5" opacity=".3" /><rect x="12.5" y="3" width="7" height="5" /><rect x="21" y="3" width="7" height="5" opacity=".55" /><rect x="4" y="9.5" width="7" height="5" opacity=".8" /><rect x="12.5" y="9.5" width="7" height="5" opacity=".3" /><rect x="21" y="9.5" width="7" height="5" /><rect x="4" y="16" width="7" height="5" opacity=".55" /><rect x="12.5" y="16" width="7" height="5" opacity=".8" /><rect x="21" y="16" width="7" height="5" opacity=".3" /></G> },
  { kind: 'calendar', label: 'Calendar', hint: 'A month of days with counts.', glyph: <G><rect x="4" y="4" width="24" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="4" y="4" width="24" height="5" /><rect x="8" y="12" width="3" height="3" /><rect x="14.5" y="12" width="3" height="3" opacity=".5" /><rect x="21" y="12" width="3" height="3" /></G> },
];

export function ChartPicker({ chart, onChange, result, kinds }: { chart: ChartSpec; onChange: (c: ChartSpec) => void; result?: ReportResult; kinds?: ChartKind[] }) {
  const shown = CHART_KINDS.filter((k) => !kinds || kinds.includes(k.kind));
  const measures = result?.columns.filter((c) => c.role === 'agg') ?? [];
  return (
    <div className="stack">
      <div className="rp-chart-grid" role="radiogroup" aria-label="How to show the result">
        {shown.map((k) => {
          const why = chartFit(k.kind, result);
          return (
            <button key={k.kind} type="button" role="radio" aria-checked={chart.kind === k.kind} disabled={Boolean(why)} title={why ?? k.hint}
              className={cx('rp-chart-kind', chart.kind === k.kind && 'is-on')} onClick={() => onChange({ ...chart, kind: k.kind })}>
              {k.glyph}<span>{k.label}</span>
            </button>
          );
        })}
      </div>
      {chart.kind === 'gauge' && (
        <div className="rp-group-row">
          <NumberField label="Target" value={chart.target ?? null} onChange={(v) => onChange({ ...chart, target: v ?? undefined })} hint="Marked on the dial." />
          <NumberField label="Full scale" value={chart.max ?? null} onChange={(v) => onChange({ ...chart, max: v ?? undefined })} hint="The figure at the end of the dial." />
        </div>
      )}
      {measures.length > 1 && !['table', 'number'].includes(chart.kind) && (
        <Select label="Figure to draw" required value={String(Math.min(chart.measure ?? 0, measures.length - 1))} options={measures.map((m, i) => ({ value: String(i), label: m.label }))}
          onChange={(v) => onChange({ ...chart, measure: Number(v) })} hint="A chart shows one figure at a time; the table keeps them all." />
      )}
    </div>
  );
}

// ---------- sharing ----------

export function ShareFields({ sharing, roles, onChange, what }: { sharing: Sharing; roles: string[]; onChange: (s: Sharing, roles: string[]) => void; what: string }) {
  const all = useFetch<{ key: string; name: string }[]>('/api/reports/roles');
  return (
    <div className="stack">
      <Select label="Who can see it" required value={sharing} onChange={(v) => onChange(v as Sharing, roles)}
        options={[{ value: 'private', label: 'Only me' }, { value: 'roles', label: 'People in chosen roles' }, { value: 'everyone', label: `Everyone who can view ${what}s` }]}
        hint={`Sharing shows people this ${what}. The figures in it are always worked out from what each person is allowed to see.`} />
      {sharing === 'roles' && (
        <div className="row">
          <MultiSelect label={roles.length ? `${roles.length} ${roles.length === 1 ? 'role' : 'roles'} chosen` : 'Choose roles'} value={roles} onChange={(r) => onChange(sharing, r)}
            options={(all.data ?? []).map((r) => ({ value: r.key, label: r.name }))} />
          <span className="muted">{roles.map((k) => all.data?.find((r) => r.key === k)?.name ?? k).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
