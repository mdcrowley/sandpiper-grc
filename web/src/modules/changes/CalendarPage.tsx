import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  Badge, Button, Card, EmptyState, ErrorState, formatDateTime, Icon, IconButton, Loading, LookupChip, PageHeader, qs, RecordPicker,
  todayInZone, useAuth, useFetch, useLookup, useResource,
} from '../../core';
import { Banner } from './bits';
import { CalendarMonth } from './CalendarMonth';
import { CalendarWeek } from './CalendarWeek';
import type { CalendarData } from './types';
import { addDays, addMonths, dayLabel, monthLabel, monthStart, plural, startOfDay, weekStart } from './util';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Change calendar: month and week views with blackout periods shaded and conflicts marked. */
export function CalendarPage() {
  const { can } = useAuth();
  const types = useLookup('change_type');
  const [params, setParams] = useSearchParams();
  const hasSystems = Boolean(useResource('system'));
  const view = params.get('view') === 'week' ? 'week' : 'month';
  const date = DAY.test(params.get('date') ?? '') ? params.get('date')! : todayInZone();
  const system = params.get('system') ?? '';
  const go = (next: { view?: string; date?: string; system?: string | null }) => {
    const s = next.system === undefined ? system : next.system ?? '';
    setParams({ view: next.view ?? view, date: next.date ?? date, ...(s ? { system: s } : {}) }, { replace: true });
  };

  const days = useMemo(() => {
    const first = view === 'week' ? weekStart(date) : weekStart(monthStart(date));
    return Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => addDays(first, i));
  }, [view, date]);
  const url = `/api/changes/calendar${qs({ from: startOfDay(days[0]), to: startOfDay(addDays(days[days.length - 1], 1)), system_id: system })}`;
  const { data, error, reload } = useFetch<CalendarData>(url, { keepPrevious: true });

  const step = (n: number) => go({ date: view === 'week' ? addDays(date, 7 * n) : addMonths(date, n) });
  const title = view === 'week' ? `${dayLabel(days[0])} to ${dayLabel(days[6])} ${days[6].slice(0, 4)}` : monthLabel(date);
  const flagged = data?.changes.filter((c) => c.unacknowledged > 0) ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Change calendar"
        subtitle="Planned changes, blackout periods and clashes."
        breadcrumbs={[{ label: 'Changes', to: '/changes' }, { label: 'Calendar' }]}
        actions={can('changes.create') && <Link className="btn btn-primary" to="/changes/new"><Icon name="plus" /> New change</Link>}
      />

      <div className="chg-cal-bar">
        <div className="row">
          <IconButton icon="chevron-left" label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)} />
          <Button onClick={() => go({ date: todayInZone() })}>Today</Button>
          <IconButton icon="chevron-right" label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)} />
          <h2 className="chg-cal-title" aria-live="polite">{title}</h2>
        </div>
        <div className="row chg-cal-tools">
          {hasSystems && (
            <RecordPicker label="System" hideLabel type="system" value={system || null} display={data?.system?.label}
              placeholder="All systems" onChange={(id) => go({ system: id })} className="chg-cal-system" />
          )}
          <SegmentedControl
            aria-label="Calendar view"
            value={view}
            onChange={(v) => go({ view: v })}
            data={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]}
          />
        </div>
      </div>
      {data?.system && (
        <Banner>
          Showing only changes that affect <strong>{data.system.label}</strong>, and the blackout periods that apply to it.{' '}
          <button type="button" className="chg-linkbtn" onClick={() => go({ system: null })}>Show all systems</button>
        </Banner>
      )}

      {error && !data ? <ErrorState title="The calendar could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={8} label="Loading the calendar" />
        : (
          <>
            {flagged.length > 0 && (
              <Banner tone="warn">
                {plural(flagged.length, 'change')} in this period {flagged.length === 1 ? 'has a conflict' : 'have conflicts'} that {flagged.length === 1 ? 'has' : 'have'} not been resolved or acknowledged. See the list below the calendar.
              </Banner>
            )}
            <Card flush>
              {view === 'week'
                ? <CalendarWeek days={days} changes={data.changes} blackouts={data.blackouts} />
                : <CalendarMonth days={days} month={monthStart(date)} changes={data.changes} blackouts={data.blackouts} onOpenDay={(day) => go({ view: 'week', date: day })} />}
            </Card>
            {data.changes.length === 0 && data.blackouts.length === 0 && (
              <p className="muted">Nothing is planned in this period.</p>
            )}

            <ul className="chg-legend" aria-label="Key">
              {types.map((t) => <li key={t.value}><span className="chg-legend-swatch" style={{ background: `var(--c-${t.color ?? 'gray'}-solid)` }} /> {t.label}</li>)}
              <li><span className="chg-legend-swatch chg-legend-draft" /> Draft</li>
              <li><span className="chg-legend-shade" /> Blackout period</li>
              <li><Icon name="alert" size={14} className="chg-ev-mark" /> Unresolved conflict</li>
              <li><Icon name="check" size={14} className="chg-ev-mark-ok" /> Conflict acknowledged</li>
            </ul>

            <div className="grid-2">
              <Card title="Conflicts in this period" flush>
                {flagged.length === 0 ? (
                  <EmptyState icon="check" title="No unresolved conflicts" message="No change in this period clashes with a blackout period or with another change to the same system." />
                ) : (
                  <ul className="chg-flagged">
                    {flagged.map((c) => (
                      <li key={c.id}>
                        <p><Link to={`/changes/${c.id}?tab=conflicts`}>{c.ref} {c.title}</Link> <LookupChip list="change_status" value={c.status} /></p>
                        <p className="muted">{formatDateTime(c.planned_start)} to {formatDateTime(c.planned_end)}</p>
                        <ul>
                          {c.conflicts.filter((x) => !x.acknowledged).map((x) => <li key={x.key}>{x.summary}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card
                title="Blackout periods in this period"
                flush
                actions={can('changes.administer') && <Link className="btn btn-secondary btn-sm" to="/changes/settings?tab=blackouts">Manage</Link>}
              >
                {data.blackouts.length === 0 ? (
                  <EmptyState icon="calendar" title="No blackout periods" message="Blackout periods are times when changes should not be made, such as a financial year-end." />
                ) : (
                  <ul className="chg-flagged">
                    {data.blackouts.map((b) => (
                      <li key={`${b.id}-${b.starts_at}`}>
                        <p>
                          <strong>{b.name}</strong>{' '}
                          {b.repeat && b.repeat !== 'none' && <Badge color="gray">{b.repeat === 'weekly' ? 'Every week' : 'Every month'}</Badge>}
                        </p>
                        <p className="muted">{formatDateTime(b.starts_at)} to {formatDateTime(b.ends_at)}</p>
                        <p className="muted">{b.systems?.length ? `Only for ${b.systems.map((s) => s.label).join(', ')}` : 'All systems'}</p>
                        {b.reason && <p>{b.reason}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
    </div>
  );
}
