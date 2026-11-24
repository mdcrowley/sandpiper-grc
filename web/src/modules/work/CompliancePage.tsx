// The compliance calendar (E41-03): everything dated across every area that is on, in a month grid or a
// list, and the person's own due work (overdue included). Each item comes from a calendar source a
// module registers (server core/calendar.ts); the server applies every visibility rule, and leaves out
// switched-off areas, so this page only shows and filters what it is given.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  Badge, Button, Card, cx, EmptyState, ErrorState, formatDate, formatDateTime, Icon, IconButton, Loading, Notice, PageHeader, qs,
  Select, TableWrap, todayInZone, UserPicker, useAuth, useFetch,
} from '../../core';
import type { ComplianceCalendar, DueItem, MyDueWork } from '../../../../shared/work-api.ts';
import { addMonths, dayOfItem, monthEndOf, monthGrid, monthLabel, monthStartOf, WEEKDAYS } from './dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PALETTE = ['blue', 'teal', 'purple', 'amber', 'green', 'orange', 'gray'] as const;
const MAX_IN_DAY = 3;

type View = 'month' | 'list' | 'mine';

/** A steady color per area, from its place in the list of areas. */
function areaColors(areas: { key: string }[]): Map<string, string> {
  return new Map(areas.map((a, i) => [a.key, PALETTE[i % PALETTE.length]]));
}

const whenOf = (i: DueItem) => (i.allDay ? formatDate(i.start) : formatDateTime(i.start));

/** Words for the tooltip and screen readers. */
function describe(i: DueItem): string {
  return [i.title, i.kind, whenOf(i), i.personName ? `for ${i.personName}` : null, i.overdue ? 'overdue' : null].filter(Boolean).join(', ');
}

function ItemLink({ item, color }: { item: DueItem; color: string }) {
  return (
    <Link to={item.url} className={cx('cc-ev', `cc-ev-${color}`, item.overdue && 'cc-ev-overdue', !item.work && 'cc-ev-date')} title={describe(item)}>
      {item.overdue && <Icon name="alert" size={12} />}
      {item.restricted && <Icon name="lock" size={12} label="Restricted" />}
      <span className="cc-ev-title">{item.title}</span>
    </Link>
  );
}

function MonthGrid({ date, items, colors, onOpenDay }: { date: string; items: DueItem[]; colors: Map<string, string>; onOpenDay: (day: string) => void }) {
  const today = todayInZone();
  const days = monthGrid(date);
  const byDay = new Map<string, DueItem[]>();
  for (const i of items) {
    const d = dayOfItem(i.start);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  }
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div className="cc-month" role="table" aria-label="Items due by day">
      <div className="cc-month-head" role="row">
        {WEEKDAYS.map((w) => <span key={w} role="columnheader"><abbr title={w}>{w.slice(0, 3)}</abbr></span>)}
      </div>
      <div className="cc-month-body" role="rowgroup">
        {weeks.map((week) => (
          <div key={week[0]} className="cc-month-week" role="row">
            {week.map((day) => {
              const list = byDay.get(day) ?? [];
              return (
                <div key={day} role="cell" className={cx('cc-day', day.slice(0, 7) !== date.slice(0, 7) && 'cc-day-out', day === today && 'cc-day-today')}>
                  <button type="button" className="cc-day-num" onClick={() => onOpenDay(day)}>
                    {Number(day.slice(8))}
                    <span className="sr-only">, {formatDate(day)}{list.length ? `, ${list.length} ${list.length === 1 ? 'item' : 'items'}` : ''}: show in the list</span>
                  </button>
                  {list.slice(0, MAX_IN_DAY).map((i) => <ItemLink key={i.uid} item={i} color={colors.get(i.area) ?? 'gray'} />)}
                  {list.length > MAX_IN_DAY && (
                    <button type="button" className="cc-linkbtn cc-more" onClick={() => onOpenDay(day)}>{list.length - MAX_IN_DAY} more</button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemTable({ items, label, showPerson, colors }: { items: DueItem[]; label: string; showPerson: boolean; colors: Map<string, string> }) {
  return (
    <TableWrap label={label} fit>
      <table className="table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" data-priority="1">Due</th>
            <th scope="col" data-priority="1">Item</th>
            <th scope="col" data-priority="2">Kind</th>
            {showPerson && <th scope="col" data-priority="2">Person</th>}
            <th scope="col" data-priority="3">Area</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.uid} id={`cc-${i.uid}`} data-day={dayOfItem(i.start)}>
              <td className="nowrap">
                {whenOf(i)} {i.overdue && <Badge color="red">Overdue</Badge>}
              </td>
              <td>
                <Link to={i.url}>{i.restricted && <Icon name="lock" size={12} label="Restricted" />} {i.title}</Link>
              </td>
              <td>{i.kind}</td>
              {showPerson && <td>{i.personName ?? <span className="muted">No one</span>}</td>}
              <td><span className={`cc-swatch cc-swatch-${colors.get(i.area) ?? 'gray'}`} aria-hidden="true" /> {i.areaLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** The compliance calendar page (`/calendar`). Query: view, date, area, kind, person (`me`, `all` or a user id). */
export function CompliancePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : params.get('view') === 'mine' ? 'mine' : 'month';
  const date = DAY.test(params.get('date') ?? '') ? params.get('date')! : todayInZone();
  const area = params.get('area') ?? '';
  const kind = params.get('kind') ?? '';
  const rawPerson = params.get('person') ?? 'me';
  const person = rawPerson === 'all' || UUID.test(rawPerson) ? (rawPerson === user?.id ? 'me' : rawPerson) : 'me';
  const [picking, setPicking] = useState(false);
  const whose = picking || UUID.test(person) ? 'other' : person === 'all' ? 'all' : 'me';

  const go = (next: Partial<Record<'view' | 'date' | 'area' | 'kind' | 'person', string>>) => {
    const merged = { view, date, area, kind, person, ...next };
    const out: Record<string, string> = { view: merged.view, date: merged.date };
    if (merged.area) out.area = merged.area;
    if (merged.kind) out.kind = merged.kind;
    if (merged.person && merged.person !== 'me') out.person = merged.person;
    setParams(out, { replace: true });
  };

  const grid = useMemo(() => monthGrid(date), [date]);
  const range = view === 'month' ? { from: grid[0], to: grid[grid.length - 1] } : { from: monthStartOf(date), to: monthEndOf(date) };
  const cal = useFetch<ComplianceCalendar>(view === 'mine' ? null
    : `/api/work/calendar${qs({ ...range, person, area: area || undefined, kind: kind || undefined })}`, { keepPrevious: true });
  // The filters' choices come from the calendar answer; the My due work view asks for them once too.
  const choices = useFetch<ComplianceCalendar>(view === 'mine' ? `/api/work/calendar${qs({ from: todayInZone(), to: todayInZone() })}` : null);
  const mine = useFetch<MyDueWork>(view === 'mine' ? `/api/work/mine${qs({ limit: 200, days: 60 })}` : null, { keepPrevious: true });
  const meta = view === 'mine' ? choices.data : cal.data;
  const colors = useMemo(() => areaColors(meta?.areas ?? []), [meta?.areas]);

  const kindOptions = (meta?.kinds ?? []).filter((k) => !area || k.area === area)
    .filter((k, i, all) => all.findIndex((x) => x.key === k.key) === i)
    .map((k) => ({ value: k.key, label: k.kind })).sort((a, b) => a.label.localeCompare(b.label));
  const ownOnlyNames = (cal.data?.ownOnly ?? []).map((k) => cal.data?.kinds.find((x) => x.key === k)?.kind ?? k);

  const mineItems = (mine.data?.sections ?? [])
    .filter((s) => (!area || s.area === area) && (!kind || s.key === kind))
    .flatMap((s) => s.items).sort((a, b) => a.start.localeCompare(b.start));

  const openDay = (day: string) => {
    go({ view: 'list', date: day });
    // Bring the day's first item into view once the list has drawn.
    window.setTimeout(() => document.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ block: 'center' }), 300);
  };

  const failed = view === 'mine' ? mine.error : cal.error;
  const ready = view === 'mine' ? mine.data : cal.data;
  const reload = view === 'mine' ? mine.reload : cal.reload;

  return (
    <div className="stack">
      <PageHeader
        title="Compliance calendar"
        subtitle="Everything due across every area that is on: every kind of dated work, in one calendar."
        actions={<Link className="btn btn-secondary" to="/account/calendar-feeds"><Icon name="calendar" /> Calendar feeds</Link>}
      />

      <div className="cc-bar">
        <div className="row">
          {view !== 'mine' && (
            <>
              <IconButton icon="chevron-left" label="Previous month" onClick={() => go({ date: addMonths(date, -1) })} />
              <Button onClick={() => go({ date: todayInZone() })}>Today</Button>
              <IconButton icon="chevron-right" label="Next month" onClick={() => go({ date: addMonths(date, 1) })} />
              <h2 className="cc-title" aria-live="polite">{monthLabel(date)}</h2>
            </>
          )}
          {view === 'mine' && <h2 className="cc-title">My due work</h2>}
        </div>
        <SegmentedControl
          aria-label="Calendar view"
          value={view}
          onChange={(v) => go({ view: v })}
          data={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'List' }, { value: 'mine', label: 'My due work' }]}
        />
      </div>

      <div className="cc-filters">
        <Select label="Area" value={area} onChange={(v) => go({ area: v, kind: '' })} className="cc-filter"
          options={[{ value: '', label: 'All areas' }, ...(meta?.areas ?? []).map((a) => ({ value: a.key, label: a.label }))]} />
        <Select label="Kind" value={kind} onChange={(v) => go({ kind: v })} className="cc-filter"
          options={[{ value: '', label: 'All kinds' }, ...kindOptions]} />
        {view !== 'mine' && (
          <Select label="Whose" value={whose} className="cc-filter"
            onChange={(v) => { setPicking(v === 'other'); if (v !== 'other') go({ person: v }); }}
            options={[{ value: 'me', label: 'Mine' }, { value: 'all', label: 'Everyone' }, { value: 'other', label: 'One person' }]} />
        )}
        {view !== 'mine' && whose === 'other' && (
          <UserPicker label="Person" value={UUID.test(person) ? person : null} className="cc-filter"
            onChange={(id) => { if (id) go({ person: id }); }} placeholder="Find a person" />
        )}
      </div>
      {view !== 'mine' && whose === 'me' && (
        <p className="muted cc-hint">Showing your own items. Choose <strong>Everyone</strong> or <strong>One person</strong> under Whose to see others' work you may see.</p>
      )}
      {ownOnlyNames.length > 0 && (
        <Notice>Only your own items are shown for: {ownOnlyNames.join(', ')}.</Notice>
      )}
      {cal.data?.truncated && view !== 'mine' && <Notice tone="warning">There are more items than can be shown. Choose an area, a kind or a person.</Notice>}

      {failed && !ready ? <ErrorState title="The calendar could not be loaded" error={failed} onRetry={reload} />
        : !ready ? <Loading lines={8} label="Loading the calendar" />
        : view === 'month' ? (
          <>
            <Card flush>
              <MonthGrid date={date} items={cal.data!.items} colors={colors} onOpenDay={openDay} />
            </Card>
            {cal.data!.items.length === 0 && <p className="muted">Nothing is due in this period{area || kind ? ' for this choice' : ''}.</p>}
            <ul className="cc-legend" aria-label="Key">
              {(cal.data!.areas ?? []).filter((a) => cal.data!.items.some((i) => i.area === a.key)).map((a) => (
                <li key={a.key}><span className={`cc-swatch cc-swatch-${colors.get(a.key) ?? 'gray'}`} /> {a.label}</li>
              ))}
              <li><Icon name="alert" size={14} /> Overdue</li>
              <li><span className="cc-swatch cc-swatch-date" /> A date to know about (not work to do)</li>
            </ul>
          </>
        ) : view === 'list' ? (
          cal.data!.items.length === 0
            ? <EmptyState icon="calendar" title="Nothing due" message={`Nothing is due in ${monthLabel(date)}${area || kind ? ' for this choice' : ''}.`} />
            : <Card flush><ItemTable items={cal.data!.items} label={`Items due in ${monthLabel(date)}`} showPerson={whose !== 'me'} colors={colors} /></Card>
        ) : (
          mineItems.length === 0
            ? <EmptyState icon="check" title="Nothing waiting" message="You have no due work that is overdue or due in the next 60 days." />
            : (
              <>
                <p className="muted">Your own work that is overdue or due in the next 60 days ({mineItems.filter((i) => i.overdue).length} overdue).</p>
                <Card flush><ItemTable items={mineItems} label="My due work" showPerson={false} colors={colors} /></Card>
              </>
            )
        )}
    </div>
  );
}
