import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Menu } from '@mantine/core';
import { Badge, Button, EmptyState, Icon, cx, formatDate, todayInZone } from '../../core';
import type { BoardFilters, Density } from './boardState';
import { matches } from './boardState';
import { OwnerAvatar, StatusBar, TargetRing } from './StatusBar';
import type { Board, BoardOutcome, ScaleValue } from './types';
import { statusVars } from './types';

interface TileProps {
  outcome: BoardOutcome;
  statuses: ScaleValue[];
  phase: Board['phases'][number] | undefined;
  density: Density;
  canEdit: boolean;
  /** This tile's status menu is open. */
  editing: boolean;
  saving: boolean;
  today: string;
  onEdit: (id: string | null) => void;
  onPick: (outcome: BoardOutcome, status: string) => void;
}

/** One outcome. The link opens it; the status pill (for people who may edit) changes the status in place. */
const Tile = memo(function Tile({ outcome: o, statuses, phase, density, canEdit, editing, saving, today, onEdit, onPick }: TileProps) {
  const status = statuses.find((s) => s.value === o.status);
  const label = status?.label ?? o.status;
  const text = o.description || o.official_text || 'No description yet';
  const overdue = Boolean(o.review_on) && o.review_on! < today;
  const name = `${o.code}, ${label}${o.priority ? ', priority outcome' : ''}. ${text}`;

  const pill = (
    <button
      type="button" className="fw-pill" tabIndex={-1} disabled={saving}
      aria-haspopup="menu" aria-expanded={editing}
      aria-label={`Change status of ${o.code}, now ${label}`}
      onClick={() => onEdit(editing ? null : o.id)}
    >
      <span className="fw-pill-dot" />{label}<Icon name="chevron-down" size={12} />
    </button>
  );

  return (
    <div className={cx('fw-tile', `fw-tile-${density}`, o.priority && 'is-priority', saving && 'is-saving')} style={statusVars(status?.color ?? 'gray') as CSSProperties}>
      <Link
        className="fw-tile-link" to={`/frameworks/outcomes/${o.id}`} data-tile={o.id} tabIndex={-1}
        aria-label={name} title={density === 'map' ? name : undefined}
      >
        <span className="fw-tile-head">
          <span className="fw-tile-code">{o.code}</span>
          {o.priority && <span className="fw-star"><Icon name="star" size={density === 'map' ? 10 : 13} /></span>}
        </span>
        {density !== 'map' && <span className="fw-tile-text">{text}</span>}
        {density === 'detailed' && (
          <span className="fw-tile-foot">
            {phase && <Badge color={phase.color}>{phase.label}</Badge>}
            {o.review_on && (
              <span className={overdue ? 'fw-review is-overdue' : 'fw-review'}>
                <Icon name="calendar" size={12} />{overdue ? 'Review overdue' : `Review ${formatDate(o.review_on)}`}
              </span>
            )}
            <span className="fw-tile-owner">{o.owner_name ? <OwnerAvatar name={o.owner_name} /> : <span className="fw-no-owner">No owner</span>}</span>
          </span>
        )}
      </Link>
      {density !== 'map' && (
        !canEdit ? <span className="fw-pill fw-pill-static"><span className="fw-pill-dot" />{label}</span>
          : !editing ? pill
          : (
            <Menu opened onChange={(open) => { if (!open) onEdit(null); }} position="bottom-end" withinPortal width={200}>
              <Menu.Target>{pill}</Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Status of {o.code}</Menu.Label>
                {statuses.map((s) => (
                  <Menu.Item
                    key={s.value}
                    leftSection={<span className="fw-swatch" style={{ background: `var(--c-${s.color}-solid)` }} />}
                    rightSection={s.value === o.status ? <Icon name="check" size={14} /> : undefined}
                    onClick={() => onPick(o, s.value)}
                  >
                    {s.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )
      )}
    </div>
  );
});

export interface BoardViewProps {
  board: Board;
  filters: BoardFilters;
  density: Density;
  canEdit: boolean;
  savingId: string | null;
  onClear: () => void;
  onStatus: (outcome: BoardOutcome, status: string) => void;
}

/** Functions as colour-banded sections, categories inside, one tile per outcome. */
export function BoardView({ board, filters, density, canEdit, savingId, onClear, onStatus }: BoardViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const today = todayInZone();

  const tiles = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])];
  const focusTile = (id: string) => root.current?.querySelector<HTMLElement>(`[data-tile="${id}"]`)?.focus();

  // Roving focus: one tile is in the Tab order; the arrow keys move between tiles.
  useEffect(() => {
    const all = tiles();
    if (all.length && !all.some((t) => t.tabIndex === 0)) all[0].tabIndex = 0;
  });

  const onEdit = useCallback((id: string | null) => {
    setEditing((was) => {
      // The menu is unmounted when it closes, so focus goes back to the tile by hand.
      if (id === null && was) requestAnimationFrame(() => focusTile(was));
      return id;
    });
  }, []);
  const onPick = useCallback((o: BoardOutcome, status: string) => {
    setEditing(null);
    requestAnimationFrame(() => focusTile(o.id));
    if (status !== o.status) onStatus(o, status);
  }, [onStatus]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]');
    if (!current || e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.key === 's' || e.key === 'S') && canEdit && density !== 'map') {
      e.preventDefault();
      // Opened once this key press has finished, or the new menu would see the same press and close.
      const id = current.dataset.tile ?? null;
      setTimeout(() => setEditing(id), 0);
      return;
    }
    const all = tiles();
    const i = all.indexOf(current);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowRight') next = all[i + 1];
    else if (e.key === 'ArrowLeft') next = all[i - 1];
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // The nearest tile in the next row of tiles in that direction, wherever its category is.
      const from = current.getBoundingClientRect();
      const mid = from.left + from.width / 2;
      const down = e.key === 'ArrowDown';
      let best = Infinity;
      for (const t of down ? all.slice(i + 1) : all.slice(0, i).reverse()) {
        const r = t.getBoundingClientRect();
        const gap = down ? r.top - from.bottom : from.top - r.bottom;
        if (gap < -1) continue;
        const score = gap * 4 + Math.abs(r.left + r.width / 2 - mid);
        if (score < best) { best = score; next = t; }
        if (gap > from.height * 3 && next) break;
      }
    } else return;
    e.preventDefault();
    if (!next) return;
    current.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  const sections = board.functions
    .map((fn) => ({
      fn,
      categories: fn.categories
        .map((c) => ({ ...c, shown: c.outcomes.filter((o) => matches(o, filters)) }))
        .filter((c) => c.shown.length),
    }))
    .filter((s) => s.categories.length);

  if (!sections.length) {
    return (
      <EmptyState
        icon="filter"
        title="No outcomes match these filters"
        message="Clear the filters to see the whole framework."
        action={<Button onClick={onClear}>Clear filters</Button>}
      />
    );
  }

  const targetLabel = board.statuses.find((s) => s.value === board.target.status)?.label ?? board.target.status;

  return (
    <div className={cx('fw-board', `fw-board-${density}`)} ref={root} onKeyDown={onKeyDown}>
      {sections.map(({ fn, categories }) => {
        // In priority focus the band counts priority outcomes only.
        const tally = filters.priority ? fn.priority : fn.all;
        const what = filters.priority ? 'priority outcomes' : 'outcomes';
        return (
          <section key={fn.code} className="fw-band" aria-label={`${fn.name} function`} style={{ '--fw-band': `var(--c-${fn.color}-solid)`, '--fw-band-bg': `var(--c-${fn.color}-bg)`, '--fw-band-fg': `var(--c-${fn.color}-fg)` } as CSSProperties}>
            <header className="fw-band-head">
              <TargetRing tally={tally} color={fn.color} size={60} label={`${fn.name}, ${what}`} />
              <div className="fw-band-title">
                <h2><span className="fw-band-code">{fn.code}</span>{fn.name}</h2>
                {fn.description && <p title={fn.description}>{fn.description}</p>}
              </div>
              <div className="fw-band-stats">
                <div className="fw-band-figure">
                  <strong>{tally.atTarget}</strong> of {tally.total} {what} at “{targetLabel}” or better
                </div>
                <StatusBar tally={tally} scale={board.statuses} label={`${fn.name}: ${what} by status`} showCounts />
              </div>
            </header>
            <div className="fw-band-body">
              {categories.map((c) => (
                <div key={c.code} className="fw-cat">
                  <h3 className="fw-cat-head" title={c.description ?? undefined}>
                    <span className="fw-cat-code">{c.code}</span>
                    <span className="fw-cat-name">{c.name}</span>
                    <span className="fw-cat-count">{c.shown.length === c.outcomes.length ? c.outcomes.length : `${c.shown.length} of ${c.outcomes.length}`}</span>
                  </h3>
                  <div className="fw-tiles">
                    {c.shown.map((o) => (
                      <Tile
                        key={o.id} outcome={o} statuses={board.statuses}
                        phase={o.phase ? board.phases.find((p) => p.value === o.phase) : undefined}
                        density={density} canEdit={canEdit} editing={editing === o.id} saving={savingId === o.id}
                        today={today} onEdit={onEdit} onPick={onPick}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
