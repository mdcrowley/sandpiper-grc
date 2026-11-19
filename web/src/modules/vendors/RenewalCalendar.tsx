// Renewal calendar: a twelve-month strip of notice dates, then an agenda grouped by how close
// each notice date is, and the contracts that cannot be placed because they have no dates.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from '@mantine/core';
import {
  api, ApiError, Button, Card, cx, EmptyState, ErrorState, errorMessage, formatCurrency, formatDate, Loading, Modal,
  PageHeader, Stat, StatusChip, TextField, toColorName, useFetch, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import { ReminderDots } from './ContractPages';
import { daysPhrase, ifWeDoNothing } from './shared';
import type { RenewalRow, Renewals } from './shared';

interface Band { key: string; title: string; short: string; hint: string; color: ColorName; rows: RenewalRow[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function DateBox({ date }: { date: string }) {
  const [y, m, d] = date.split('-').map(Number);
  return (
    <span className="vnd-datebox" aria-hidden="true">
      <span className="vnd-datebox-day">{d}</span>
      <span className="vnd-datebox-month">{MONTHS[m - 1]} {y}</span>
    </span>
  );
}

function AgendaItem({ c }: { c: RenewalRow }) {
  const left = c.days_to_notice ?? 0;
  return (
    <li className="vnd-agenda-item">
      <DateBox date={c.notice_date as string} />
      <div className="vnd-agenda-main">
        <span>
          {c.ref && <span className="ref">{c.ref} </span>}
          <Link to={`/contracts/${c.id}`} className="vnd-agenda-title">{c.title}</Link>
        </span>
        <span className="vnd-agenda-sub">
          {c.vendor_name ? <Link to={`/vendors/${c.vendor_id}`}>{c.vendor_name}</Link> : 'Vendor not shown'}
          {' · '}{c.owner_name ?? <span className="vnd-warn-text">No owner</span>}
          {c.total_value !== null && c.total_value !== undefined && <> · {formatCurrency(c.total_value)}</>}
        </span>
        <span className="vnd-agenda-nothing"><strong>If we do nothing:</strong> {ifWeDoNothing(c)}</span>
      </div>
      <div className="vnd-agenda-meta">
        <StatusChip
          color={left < 0 ? 'red' : left <= 30 ? 'red' : left <= 120 ? 'amber' : 'green'}
          label={left < 0 ? `Passed ${daysPhrase(left)}` : `Notice due ${daysPhrase(left)}`}
        />
        <span className="sr-only">Notice date {formatDate(c.notice_date)}. End date {formatDate(c.end_date)}.</span>
        <ReminderDots list={c.reminders ?? []} />
      </div>
    </li>
  );
}

/** The next twelve months, each with a mark for every notice date that falls in it. */
function MonthStrip({ data }: { data: Renewals }) {
  const [y0, m0] = data.today.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = (m0 - 1 + i) % 12;
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    return { key, label: MONTHS[m], year: y, rows: data.contracts.filter((c) => c.notice_date?.startsWith(key) && (c.days_to_notice ?? 0) >= 0) };
  });
  const tone = (c: RenewalRow) => ((c.days_to_notice ?? 0) <= 30 ? 'red' : (c.days_to_notice ?? 0) <= 120 ? 'amber' : 'green');
  return (
    <Card title="Notice dates in the next twelve months">
      <ol className="vnd-months" aria-label="Notice dates by month">
        {months.map((m, i) => (
          <li key={m.key} className={cx('vnd-month', m.rows.length === 0 && 'vnd-month-empty', i === 0 && 'vnd-month-now')}>
            <span className="vnd-month-marks">
              {m.rows.slice(0, 8).map((c) => (
                <Tooltip key={c.id} label={`${c.title}: notice by ${formatDate(c.notice_date)}`} withArrow>
                  <Link to={`/contracts/${c.id}`} className={`vnd-month-mark vnd-month-${tone(c)}`}>
                    <span className="sr-only">{c.title}, notice by {formatDate(c.notice_date)}</span>
                  </Link>
                </Tooltip>
              ))}
              {m.rows.length > 8 && <span className="vnd-month-more">+{m.rows.length - 8}</span>}
            </span>
            <span className="vnd-month-count">{m.rows.length || ''}</span>
            <span className="vnd-month-label">{m.label}{(i === 0 || m.label === 'Jan') && <span className="vnd-month-year"> {m.year}</span>}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ---------- reminder settings ---------- */

interface ReminderSettingsData { contract_days: number[]; evidence_days: number[]; can_edit: boolean; delivered: boolean }
const parseDays = (text: string) => text.split(/[\s,;]+/).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));

function ReminderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ReminderSettingsData>('/api/contracts/reminder-settings');
  const [contract, setContract] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label="Loading reminder settings" />;
  const contractText = contract ?? data.contract_days.join(', ');
  const evidenceText = evidence ?? data.evidence_days.join(', ');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.patch('/api/contracts/reminder-settings', { contract_days: parseDays(contractText), evidence_days: parseDays(evidenceText) });
      toast.success('Reminder days saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="muted">
        A reminder is sent once at each number of days. Separate the numbers with commas.
        {data.delivered ? '' : ' Notifications are not switched on in this installation, so reminders are recorded in history only.'}
      </p>
      <TextField
        label="Days before a contract's notice date" value={contractText} onChange={setContract} error={errors.contract_days}
        hint="Sent to the contract's owner and to everyone who may edit contracts." inputMode="numeric"
      />
      <TextField
        label="Days before evidence expires" value={evidenceText} onChange={setEvidence} error={errors.evidence_days}
        hint="Sent to everyone who may edit vendors, and the owner of the contract the evidence belongs to." inputMode="numeric"
      />
      <div className="form-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Save reminder days</Button>
      </div>
    </form>
  );
}

/* ---------- page ---------- */

export function RenewalCalendar() {
  const { data, error, reload } = useFetch<Renewals>('/api/contracts/renewals');
  const [settings, setSettings] = useState(false);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading the renewal calendar" />;
  else if (!data.contracts.length && !data.undated.length) {
    body = (
      <EmptyState
        icon="calendar" title="No contracts to renew"
        message="Contracts appear here once they have an end date. Reminders are sent before each notice date."
      />
    );
  } else {
    const windows = [...data.thresholds].sort((a, b) => a - b);
    const inWindow = (w: string) => data.contracts.filter((c) => c.window === w);
    const bands: Band[] = [
      {
        key: 'passed', title: 'Notice date passed', short: 'Notice date passed', color: 'red', rows: inWindow('passed'),
        hint: 'The last day to give notice has gone by. Check whether the contract renewed, and on what terms.',
      },
      ...windows.map((w, i): Band => ({
        key: String(w), rows: inWindow(String(w)), color: i === 0 ? 'orange' : i === 1 ? 'amber' : 'blue',
        short: i === 0 ? `Within ${w} days` : `${windows[i - 1] + 1} to ${w} days`,
        title: i === 0 ? `Notice due within ${w} days` : `Notice due in ${windows[i - 1] + 1} to ${w} days`,
        hint: i === 0 ? 'Decide now: renew, renegotiate or give notice.' : 'Start the renewal decision and gather what is needed.',
      })),
      {
        key: 'later', title: `More than ${windows[windows.length - 1]} days away`, short: `Over ${windows[windows.length - 1]} days`, color: 'green', rows: inWindow('later'),
        hint: 'No action needed yet.',
      },
    ];
    body = (
      <>
        <div className="grid-stats">
          {bands.map((b) => (
            <Stat
              key={b.key} value={b.rows.length} color={b.key === 'passed' && !b.rows.length ? 'green' : b.color}
              label={b.short}
            />
          ))}
          <Stat label="Cannot be placed" value={data.undated.length} color="gray" hint="no notice date" to={data.undated.length ? '/contracts/dates' : undefined} />
        </div>
        {data.contracts.length > 0 && <MonthStrip data={data} />}
        {!data.contracts.length && (
          <EmptyState
            icon="calendar" title="No notice dates yet"
            message="None of the contracts has an end date, so there is nothing to put on the calendar. Complete the dates for the contracts below."
          />
        )}
        {bands.filter((b) => b.rows.length).map((b) => (
          <section key={b.key} className={cx('vnd-band', `vnd-band-${b.color}`)} aria-labelledby={`vnd-band-${b.key}`}>
            <header className="vnd-band-head">
              <h2 id={`vnd-band-${b.key}`} className="vnd-band-title">{b.title} <span className="tab-count">{b.rows.length}</span></h2>
              <p className="muted">{b.hint}</p>
            </header>
            <ul className="vnd-agenda">{b.rows.map((c) => <AgendaItem key={c.id} c={c} />)}</ul>
          </section>
        ))}
        {data.undated.length > 0 && (
          <section className="vnd-band vnd-band-gray" aria-labelledby="vnd-band-undated">
            <header className="vnd-band-head vnd-band-head-split">
              <div>
                <h2 id="vnd-band-undated" className="vnd-band-title">Cannot be placed <span className="tab-count">{data.undated.length}</span></h2>
                <p className="muted">
                  {data.undated.length === 1 ? 'This contract has' : `These ${data.undated.length} contracts have`} no notice date,
                  so the calendar cannot place {data.undated.length === 1 ? 'it' : 'them'} and no reminder can be sent.
                </p>
              </div>
              <Link className="btn btn-primary" to="/contracts/dates">Complete the dates</Link>
            </header>
            <ul className="vnd-agenda">
              {data.undated.map((c) => (
                <li key={c.id} className="vnd-agenda-item">
                  <span className="vnd-datebox vnd-datebox-none" aria-hidden="true"><span className="vnd-datebox-day">?</span><span className="vnd-datebox-month">No date</span></span>
                  <div className="vnd-agenda-main">
                    <span>
                      {c.ref && <span className="ref">{c.ref} </span>}
                      <Link to={`/contracts/${c.id}`} className="vnd-agenda-title">{c.title}</Link>
                    </span>
                    <span className="vnd-agenda-sub">
                      {c.vendor_name ? <Link to={`/vendors/${c.vendor_id}`}>{c.vendor_name}</Link> : 'Vendor not shown'}
                      {' · '}{c.owner_name ?? <span className="vnd-warn-text">No owner</span>}
                      {c.renewal_label && <> · {c.renewal_label}</>}
                    </span>
                    {c.term_and_renewal && <span className="vnd-agenda-nothing"><strong>Term as recorded:</strong> {c.term_and_renewal}</span>}
                  </div>
                  <div className="vnd-agenda-meta">
                    {c.status && c.status !== 'active' && <StatusChip color={toColorName(c.status_color)} label={c.status_label ?? c.status} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Renewal calendar"
        subtitle={data
          ? `Reminders are sent ${data.thresholds.join(', ')} days before each notice date, to the contract's owner and the people who look after contracts.`
          : 'Contracts by notice date.'}
        breadcrumbs={[{ label: 'Contracts', to: '/contracts' }, { label: 'Renewal calendar' }]}
        actions={(
          <>
            {data?.can_administer && <Button icon="bell" onClick={() => setSettings(true)}>Reminder days</Button>}
            <Link className="btn btn-secondary" to="/contracts">All contracts</Link>
          </>
        )}
      />
      {body}
      <Modal open={settings} title="Reminder days" onClose={() => setSettings(false)}>
        {settings && <ReminderSettings onClose={() => setSettings(false)} onSaved={() => { setSettings(false); reload(); }} />}
      </Modal>
    </div>
  );
}
