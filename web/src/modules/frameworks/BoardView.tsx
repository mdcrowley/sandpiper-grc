import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, Icon, formatDate } from '../../core';
import { StatusBar } from './StatusBar';
import type { Board, BoardOutcome } from './types';
import { statusColor, statusLabel } from './types';

export interface BoardFilters {
  priorityOnly: boolean;
  statuses: string[];
  phases: string[];
  functions: string[];
  /** '' = anyone, 'none' = no owner, otherwise a user id. */
  owner: string;
}

export const NO_FILTERS: BoardFilters = { priorityOnly: false, statuses: [], phases: [], functions: [], owner: '' };

export function matches(o: BoardOutcome, f: BoardFilters): boolean {
  if (f.priorityOnly && !o.priority) return false;
  if (f.statuses.length && !f.statuses.includes(o.status)) return false;
  if (f.phases.length && !f.phases.includes(o.phase ?? '')) return false;
  if (f.functions.length && !f.functions.includes(o.function_code ?? '')) return false;
  if (f.owner === 'none' ? o.owner_id !== null : f.owner !== '' && o.owner_id !== f.owner) return false;
  return true;
}

function Tile({ outcome, board }: { outcome: BoardOutcome; board: Board }) {
  const color = statusColor(board.statuses, outcome.status);
  const phase = board.phases.find((p) => p.value === outcome.phase);
  const style = {
    '--fw-status-solid': `var(--c-${color}-solid)`,
    '--fw-status-bg': `var(--c-${color}-bg)`,
    '--fw-status-fg': `var(--c-${color}-fg)`,
  } as CSSProperties;
  return (
    <Link className="fw-tile" style={style} to={`/frameworks/outcomes/${outcome.id}`}>
      <span className="fw-tile-top">
        <span className="fw-tile-code">{outcome.code}</span>
        {outcome.priority && <span className="fw-tile-star"><Icon name="star" size={14} label="Priority outcome" /></span>}
        <span className="fw-tile-status">{statusLabel(board.statuses, outcome.status)}</span>
      </span>
      <span className="fw-tile-text">{outcome.description || outcome.official_text || 'No description yet'}</span>
      <span className="fw-tile-foot">
        {phase && <Badge color={phase.color}>{phase.label}</Badge>}
        <span>{outcome.owner_name ?? 'No owner'}</span>
        {outcome.review_on && <span>· review {formatDate(outcome.review_on)}</span>}
      </span>
    </Link>
  );
}

/** Functions as colour-banded sections, categories inside, one tile per outcome. */
export function BoardView({ board, filters, onClear }: { board: Board; filters: BoardFilters; onClear: () => void }) {
  const sections = board.functions
    .map((fn) => ({
      fn,
      categories: fn.categories
        .map((c) => ({ ...c, outcomes: c.outcomes.filter((o) => matches(o, filters)) }))
        .filter((c) => c.outcomes.length),
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

  return (
    <div className="stack">
      {sections.map(({ fn, categories }) => (
        <section key={fn.code} className="fw-function" aria-label={`${fn.name} function`}>
          <header className="fw-function-head" style={{ '--fw-band': `var(--c-${fn.color}-solid)` } as CSSProperties}>
            <h2 className="fw-function-name" title={fn.description ?? undefined}>
              <span className="fw-function-code">{fn.code}</span>{fn.name}
            </h2>
            <StatusBar tally={fn.all} scale={board.statuses} label={`${fn.name}: outcomes by status`} showCounts />
            <span className="fw-function-meta">
              {fn.priority.total
                ? `${fn.priority.atTarget} of ${fn.priority.total} priority at target`
                : `${fn.all.atTarget} of ${fn.all.total} at target`}
            </span>
          </header>
          <div className="fw-function-body">
            {categories.map((c) => (
              <div key={c.code}>
                <h3 className="fw-category-name" title={c.description ?? undefined}>
                  <span className="ref">{c.code}</span>{c.name}
                </h3>
                <div className="fw-tiles">
                  {c.outcomes.map((o) => <Tile key={o.id} outcome={o} board={board} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
