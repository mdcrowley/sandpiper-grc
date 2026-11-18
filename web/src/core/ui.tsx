// Design-system building blocks. Styles live in base.css.
import {
  useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from './api';
import { formatDateTime, formatDuration } from './format';
import { Icon, type IconName } from './Icon';
import type { ColorName } from './meta';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Buttons ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  /** Disables the button and marks it busy. */
  loading?: boolean;
}

export function Button({
  variant = 'secondary', size = 'md', icon, loading, className, children, type = 'button', disabled, ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Accessible name, also shown as the tooltip. */
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export function IconButton({
  icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', 'btn-icon', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}

/* ---------- Chips ---------- */

export function Badge({ color = 'gray', children }: { color?: ColorName; children: ReactNode }) {
  return <span className={`chip chip-${color}`}>{children}</span>;
}

/** A status or priority chip: coloured dot plus label, so colour never carries the meaning alone. */
export function StatusChip({ color = 'gray', label }: { color?: ColorName; label: ReactNode }) {
  return (
    <span className={`chip chip-${color}`}>
      <span className="chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ---------- Containers ---------- */

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Remove the body padding, e.g. around a table. */
  flush?: boolean;
  className?: string;
}

export function Card({ title, actions, children, flush, className }: CardProps) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : 'card-body'}>{children}</div>
    </section>
  );
}

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Change against the previous period. `tone` says whether the movement is good news. */
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; tone?: 'good' | 'bad' | 'neutral' };
  /** Accent bar colour. */
  color?: ColorName;
  /** Makes the whole tile a link (drill-down). */
  to?: string;
}

export function Stat({ label, value, trend, color, to }: StatProps) {
  const trendIcon = trend && ({ up: 'arrow-up', down: 'arrow-down', flat: 'minus' } as const)[trend.direction];
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {trend && trendIcon && (
        <span className={cx('stat-trend', trend.tone && trend.tone !== 'neutral' && `stat-trend-${trend.tone}`)}>
          <Icon name={trendIcon} size={14} />
          {trend.label}
        </span>
      )}
    </>
  );
  const className = cx('stat', color && `stat-${color}`);
  return to ? <Link className={className} to={to}>{body}</Link> : <div className={className}>{body}</div>;
}

/* ---------- Tabs ---------- */

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  /** Panel content; rendered only while the tab is active. */
  content?: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active key. Leave out for uncontrolled use. */
  active?: string;
  onChange?: (key: string) => void;
  /** Accessible name of the tab list. */
  label?: string;
}

export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const [own, setOwn] = useState(tabs[0]?.key);
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const current = tabs.find((t) => t.key === (active ?? own)) ?? tabs[0];
  if (!current) return null;

  const select = (key: string) => {
    setOwn(key);
    onChange?.(key);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.indexOf(current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    select(target.key);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${target.key}"]`)?.focus();
  };

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.key}`}
            data-tab={t.key}
            aria-selected={t === current}
            aria-controls={`${baseId}-panel-${t.key}`}
            tabIndex={t === current ? 0 : -1}
            className="tab"
            onClick={() => select(t.key)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {current.content !== undefined && (
        <div
          className="tabpanel"
          role="tabpanel"
          id={`${baseId}-panel-${current.key}`}
          aria-labelledby={`${baseId}-tab-${current.key}`}
          tabIndex={0}
        >
          {current.content}
        </div>
      )}
    </div>
  );
}

/* ---------- States ---------- */

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: ReactNode;
  /** Usually a Button. */
  action?: ReactNode;
}

export function EmptyState({ icon = 'folder', title, message, action }: EmptyStateProps) {
  return (
    <div className="state">
      <Icon name={icon} size={28} className="state-icon" />
      <p className="state-title">{title}</p>
      {message && <p className="state-message">{message}</p>}
      {action}
    </div>
  );
}

/** Skeleton placeholder shown while content loads. */
export function Loading({ lines = 4, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  /** Anything thrown by the api client; its message is shown. */
  error?: unknown;
  onRetry?: () => void;
}

export function ErrorState({ title = 'This could not be loaded', error, onRetry }: ErrorStateProps) {
  return (
    <div className="state" role="alert">
      <Icon name="alert" size={28} className="state-icon state-icon-error" />
      <p className="state-title">{title}</p>
      {error !== undefined && error !== null && <p className="state-message">{errorMessage(error)}</p>}
      {onRetry && <Button icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ---------- Stepper ---------- */

export type StepState = 'done' | 'current' | 'todo' | 'blocked';

export interface Step {
  key: string;
  label: string;
  /** Short note under the label, e.g. a date or the reason for a block. */
  hint?: string;
  /** Overrides the state derived from `current`. */
  state?: StepState;
}

export interface StepperProps {
  steps: Step[];
  /** Key of the current stage: earlier steps show as done, later ones as to do. */
  current?: string;
  /** Marks the current stage as blocked. */
  blocked?: boolean;
  /** Makes steps clickable (e.g. to move the record to that stage). */
  onStepClick?: (key: string) => void;
  label?: string;
}

const STEP_WORD: Record<StepState, string> = { done: 'Done', current: 'Current', todo: 'Not started', blocked: 'Blocked' };

export function Stepper({ steps, current, blocked, onStepClick, label = 'Progress' }: StepperProps) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((step, i) => {
        const derived: StepState = at < 0 ? 'todo' : i < at ? 'done' : i > at ? 'todo' : blocked ? 'blocked' : 'current';
        const state = step.state ?? derived;
        const inner = (
          <>
            <span className="step-marker" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={14} /> : state === 'blocked' ? <Icon name="x" size={14} /> : i + 1}
            </span>
            <span className="step-text">
              <span className="step-label">{step.label}</span>
              {step.hint && <span className="step-hint">{step.hint}</span>}
              <span className="sr-only"> ({STEP_WORD[state]})</span>
            </span>
          </>
        );
        return (
          <li key={step.key} className={`step step-${state}`} aria-current={i === at ? 'step' : undefined}>
            {onStepClick
              ? <button type="button" className="step-body" onClick={() => onStepClick(step.key)}>{inner}</button>
              : <span className="step-body">{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Countdown ---------- */

export interface CountdownProps {
  /** The deadline (ISO string or Date). Nothing is counted when empty. */
  deadline: string | Date | null | undefined;
  /** When the clock started. With it, amber begins once under a quarter of the window is left. */
  start?: string | Date | null;
  /** Amber threshold in milliseconds when `start` is not given (default 24 hours). */
  warnMs?: number;
  /** When the work was finished: the clock stops and shows met or missed. */
  completedAt?: string | Date | null;
  /** Clock on hold (e.g. waiting on the requester). */
  paused?: boolean;
  /** Text before the time, e.g. "Response". */
  label?: string;
}

function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const HOUR = 3_600_000;

/** Time left to a deadline: green with time in hand, amber when close, red when overdue. */
export function Countdown({ deadline, start, warnMs, completedAt, paused, label }: CountdownProps) {
  const due = deadline ? new Date(deadline).getTime() : NaN;
  const done = completedAt ? new Date(completedAt).getTime() : null;
  const live = !Number.isNaN(due) && done === null && !paused;
  const [fast, setFast] = useState(false);
  const now = useNow(live ? (fast ? 1000 : 30_000) : null);
  const left = due - now;
  const nearNow = live && Math.abs(left) < HOUR;
  useEffect(() => setFast(nearNow), [nearNow]);

  let color: ColorName = 'gray';
  let text = 'No deadline';
  if (!Number.isNaN(due)) {
    const startMs = start ? new Date(start).getTime() : NaN;
    const warn = warnMs ?? (Number.isNaN(startMs) ? 24 * HOUR : (due - startMs) / 4);
    if (done !== null) {
      color = done <= due ? 'green' : 'red';
      text = done <= due ? 'Met' : `Missed by ${formatDuration(done - due)}`;
    } else if (paused) {
      text = 'Paused';
    } else if (left < 0) {
      color = 'red';
      text = `Overdue by ${formatDuration(left)}`;
    } else {
      color = left <= warn ? 'amber' : 'green';
      text = `${formatDuration(left)} left`;
    }
  }
  return (
    <span className={`chip chip-${color} countdown`} title={Number.isNaN(due) ? undefined : `Due ${formatDateTime(due)}`}>
      <Icon name={color === 'red' ? 'alert' : 'clock'} size={14} />
      {label && <span className="countdown-label">{label}:</span>}
      {text}
    </span>
  );
}

/* ---------- Progress ---------- */

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name; also shown above the bar unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  color?: ColorName;
  /** Text at the right, default "64%". */
  valueText?: string;
}

export function ProgressBar({ value, max = 100, label, hideLabel, color = 'blue', valueText }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const text = valueText ?? `${Math.round(pct)}%`;
  return (
    <div className="progress">
      {!hideLabel && (
        <div className="progress-head">
          <span>{label}</span>
          <span className="muted">{text}</span>
        </div>
      )}
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(max, Math.max(0, value))}
        aria-valuetext={text}
      >
        <div className="progress-fill" style={{ width: `${pct}%`, background: `var(--c-${color}-solid)` }} />
      </div>
    </div>
  );
}

/* ---------- Page header ---------- */

export interface Crumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: string;
  /** Record reference shown before the title, e.g. "TKT-00042". */
  reference?: string;
  subtitle?: ReactNode;
  /** Usually a StatusChip or LookupChip. */
  status?: ReactNode;
  /** Buttons at the right. */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
}

const APP_TITLE = document.title;

/** Page heading. Also sets the browser tab title. */
export function PageHeader({ title, reference, subtitle, status, actions, breadcrumbs }: PageHeaderProps) {
  useEffect(() => {
    document.title = `${reference ? `${reference} ` : ''}${title} · ${APP_TITLE}`;
    return () => { document.title = APP_TITLE; };
  }, [title, reference]);

  return (
    <header className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            {breadcrumbs.map((c, i) => (
              <li key={i}>{c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
            ))}
          </ol>
        </nav>
      )}
      <div className="page-header-row">
        <div className="page-header-main">
          <h1 className="page-title">
            {reference && <span className="page-ref">{reference}</span>}
            {title}
          </h1>
          {status}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </header>
  );
}

/* ---------- Definition list ---------- */

export interface DefinitionItem {
  label: string;
  value: ReactNode;
  /** Span the full width (long text). */
  wide?: boolean;
}

export function DefinitionList({ items }: { items: DefinitionItem[] }) {
  return (
    <dl className="deflist">
      {items.map((item) => (
        <div key={item.label} className={cx('deflist-item', item.wide && 'deflist-wide')}>
          <dt>{item.label}</dt>
          <dd>{item.value === null || item.value === undefined || item.value === '' ? '—' : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
