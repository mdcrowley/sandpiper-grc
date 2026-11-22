// Design-system building blocks, built on Mantine. Interactive pieces (buttons, tabs, tooltips,
// skeletons) are Mantine components; purely presentational ones render the documented helper
// classes (`card`, `chip chip-<color>` ...) so a component and its CSS class are one thing.
import {
  useEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react';
import { ActionIcon, Button as MButton, Skeleton, Tabs as MTabs, Tooltip } from '@mantine/core';
import { Link } from 'react-router-dom';
import { errorMessage } from './api';
import { appTitle } from './branding';
import { formatDateTime, formatDuration } from './format';
import { Icon, type IconName } from './Icon';
import type { ColorName } from './meta';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Makes an element a Tab stop only while its content overflows it, so a keyboard user can
 * scroll it with the arrow keys (WCAG 2.1.1). Use on a box with `overflow: auto`:
 * `const ref = useScrollFocus<HTMLDivElement>(); <div ref={ref} ...>`.
 */
export function useScrollFocus<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (scrolls) el.setAttribute('tabindex', '0'); else el.removeAttribute('tabindex');
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return setEl;
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

/** How each of our variants maps onto Mantine's. Shared with Menu targets and icon buttons. */
export const BUTTON_LOOK: Record<ButtonVariant, { variant: string; color?: string }> = {
  primary: { variant: 'filled' },
  secondary: { variant: 'default' },
  ghost: { variant: 'subtle', color: 'gray' },
  danger: { variant: 'filled', color: 'red' },
};

export function Button({
  variant = 'secondary', size = 'md', icon, loading, className, children, type = 'button', ...rest
}: ButtonProps) {
  return (
    <MButton
      type={type}
      {...BUTTON_LOOK[variant]}
      size={size === 'sm' ? 'xs' : 'sm'}
      leftSection={icon ? <Icon name={icon} size={16} /> : undefined}
      loading={loading}
      aria-busy={loading || undefined}
      className={cx('ui-btn', `ui-btn-${variant}`, className)}
      {...rest}
    >
      {children}
    </MButton>
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
    <Tooltip label={label}>
      <ActionIcon
        type={type}
        {...BUTTON_LOOK[variant]}
        size={size === 'sm' ? 28 : 36}
        aria-label={label}
        className={cx('ui-btn', 'ui-icon-btn', `ui-btn-${variant}`, className)}
        {...rest}
      >
        <Icon name={icon} size={size === 'sm' ? 16 : 18} />
      </ActionIcon>
    </Tooltip>
  );
}

/* ---------- Chips ---------- */

export function Badge({ color = 'gray', children }: { color?: ColorName; children: ReactNode }) {
  return <span className={`chip chip-${color}`}>{children}</span>;
}

/** A status or priority chip: colored dot plus label, so color never carries the meaning alone. */
export interface StatusChipProps {
  color?: ColorName;
  label: ReactNode;
  /** Mantine's Badge sizes: `sm` is the compact chip used inside dense tables. Default `md`. */
  size?: 'sm' | 'md';
  /** Mantine's Badge variants: `light` (default, tinted), `filled` (solid color), `outline`. */
  variant?: 'light' | 'filled' | 'outline';
  /** Hide the leading dot (for chips that sit next to their own icon). */
  withDot?: boolean;
  title?: string;
  className?: string;
}

export function StatusChip({ color = 'gray', label, size = 'md', variant = 'light', withDot = true, title, className }: StatusChipProps) {
  return (
    <span
      className={cx('chip', `chip-${color}`, size === 'sm' && 'chip-sm', variant !== 'light' && `chip-${variant}`, className)}
      title={title}
    >
      {withDot && <span className="chip-dot" aria-hidden="true" />}
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
  id?: string;
  /** Body padding, as Mantine's Card `padding`: `none` is the same as `flush`. Default `md`. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Mantine's Card `withBorder`. Default true; false drops the border and shadow (a card inside a card). */
  withBorder?: boolean;
}

export function Card({ title, actions, children, flush, className, id, padding = 'md', withBorder = true }: CardProps) {
  const bare = flush || padding === 'none';
  return (
    <section
      id={id}
      className={cx('card', !bare && padding !== 'md' && `card-pad-${padding}`, !withBorder && 'card-borderless', className)}
    >
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={bare ? 'card-flush' : 'card-body'}>{children}</div>
    </section>
  );
}

/**
 * The scroll box around a table (`.table-wrap`). When the table is wider than the box, the box joins the tab order as a
 * named region, so keyboard users can scroll it even when the table holds no link or button of its own.
 */
export function TableWrap({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(check);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={ref} className={cx('table-wrap', className)} role={scrolls ? 'region' : undefined}
      aria-label={scrolls ? label : undefined} tabIndex={scrolls ? 0 : undefined}>
      {children}
    </div>
  );
}

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Change against the previous period. `tone` says whether the movement is good news. */
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; tone?: 'good' | 'bad' | 'neutral' };
  /** Accent color. */
  color?: ColorName;
  /** Makes the whole tile a link (drill-down). */
  to?: string;
  /** Small icon beside the label. */
  icon?: IconName;
  /** A short line under the value (when there is no trend to show). */
  hint?: ReactNode;
  /** `sm` is a compact tile for dense rows. Default `md`. */
  size?: 'sm' | 'md';
  className?: string;
}

export function Stat({ label, value, trend, color, to, icon, hint, size = 'md', className: extra }: StatProps) {
  const trendIcon = trend && ({ up: 'arrow-up', down: 'arrow-down', flat: 'minus' } as const)[trend.direction];
  const body = (
    <>
      <span className="stat-label">
        {icon && <Icon name={icon} size={15} />}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {trend && trendIcon && (
        <span className={cx('stat-trend', trend.tone && trend.tone !== 'neutral' && `stat-trend-${trend.tone}`)}>
          <Icon name={trendIcon} size={14} />
          {trend.label}
        </span>
      )}
      {hint && <span className="stat-trend">{hint}</span>}
      {to && <Icon name="arrow-right" size={16} className="stat-go" />}
    </>
  );
  const className = cx('stat', color && `stat-${color}`, size === 'sm' && 'stat-sm', extra);
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
  const current = tabs.find((t) => t.key === (active ?? own)) ?? tabs[0];
  if (!current) return null;

  return (
    <MTabs
      className="tabs"
      value={current.key}
      keepMounted={false}
      onChange={(key) => {
        if (!key) return;
        setOwn(key);
        onChange?.(key);
      }}
    >
      <MTabs.List className="ui-tablist" aria-label={label}>
        {tabs.map((t) => (
          <MTabs.Tab
            key={t.key}
            value={t.key}
            className="ui-tab"
            rightSection={t.count !== undefined ? <span className="tab-count">{t.count}</span> : undefined}
          >
            {t.label}
          </MTabs.Tab>
        ))}
      </MTabs.List>
      {tabs.filter((t) => t.content !== undefined).map((t) => (
        <MTabs.Panel key={t.key} value={t.key} className="tabpanel">{t.content}</MTabs.Panel>
      ))}
    </MTabs>
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
      <span className="state-icon"><Icon name={icon} size={22} /></span>
      <p className="state-title">{title}</p>
      {message && <p className="state-message">{message}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

/** Skeleton placeholder shown while content loads. */
export function Loading({ lines = 4, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="skeleton-line" height={12} radius="xl" width={`${92 - ((i * 17) % 40)}%`} />
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
    <div className="state error-state" role="alert">
      <span className="state-icon state-icon-error"><Icon name="alert" size={22} /></span>
      <p className="state-title">{title}</p>
      {error !== undefined && error !== null && <p className="state-message">{errorMessage(error)}</p>}
      {onRetry && <div className="state-action"><Button icon="refresh" onClick={onRetry}>Try again</Button></div>}
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
  /** As Mantine's Stepper `active`: the index of the current step. `current` wins when both are given. */
  active?: number;
  /** As Mantine: `horizontal` (default; scrolls inside its own frame when narrow) or `vertical`. */
  orientation?: 'horizontal' | 'vertical';
  /** `sm` uses smaller markers, for a stepper inside a card or banner. Default `md`. */
  size?: 'sm' | 'md';
  className?: string;
}

const STEP_WORD: Record<StepState, string> = { done: 'Done', current: 'Current', todo: 'Not started', blocked: 'Blocked' };

// An ordered list rather than Mantine's Stepper: it needs per-step state overrides, a blocked
// state and hints, and reads as a real list of stages to assistive technology.
export function Stepper({
  steps, current, blocked, onStepClick, label = 'Progress', active, orientation = 'horizontal', size = 'md', className,
}: StepperProps) {
  const at = current !== undefined ? steps.findIndex((s) => s.key === current) : active ?? -1;
  // On a narrow screen the steps scroll sideways: the list then takes focus so the keyboard can scroll it.
  const scrollRef = useScrollFocus<HTMLOListElement>();
  return (
    <ol ref={scrollRef} className={cx('stepper', orientation === 'vertical' && 'stepper-vertical', size === 'sm' && 'stepper-sm', className)} aria-label={label}>
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
  /** Track height, as Mantine's Progress `size`. Default `md` (8px). */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** As Mantine: diagonal stripes; `animated` moves them (they stay still under reduced motion). */
  striped?: boolean;
  animated?: boolean;
  className?: string;
}

export function ProgressBar({ value, max = 100, label, hideLabel, color = 'blue', valueText, size = 'md', striped, animated, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const text = valueText ?? `${Math.round(pct)}%`;
  return (
    <div className={cx('progress', size !== 'md' && `progress-${size}`, (striped || animated) && 'progress-striped', animated && 'progress-animated', className)}>
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
        <div className="progress-fill" style={{ width: `${pct}%`, backgroundColor: `var(--c-${color}-solid)` }} />
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

/** Page heading. Also sets the browser tab title, which ends with the application name (core/branding.ts). */
export function PageHeader({ title, reference, subtitle, status, actions, breadcrumbs }: PageHeaderProps) {
  useEffect(() => {
    document.title = `${reference ? `${reference} ` : ''}${title} · ${appTitle()}`;
    return () => { document.title = appTitle(); };
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
