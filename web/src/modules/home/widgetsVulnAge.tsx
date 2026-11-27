// Dashboard panel (E45-40): open vulnerabilities by age and severity, from the vulnerability summary
// the other vulnerability panel already reads (one request for both). Each count opens the list.
import { Link } from 'react-router-dom';
import { listQuery, TableWrap } from '../../core';
import type { FetchState } from '../../core';
import { Panel } from './parts';
import { useSource } from './sources';
import type { VulnerabilitySummary, WidgetDef } from './types';

/** The parts of the summary this panel reads beyond the shared type. */
type AgedSummary = VulnerabilitySummary & {
  today: string;
  ageBuckets: { key: string; label: string; min: number; max: number | null; bySeverity: Record<string, number>; total: number }[];
};

const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** List filters for open findings first seen between `min` and `max` days ago (max null: no limit). */
function ageFilters(today: string, min: number, max: number | null, severity?: string): Record<string, string | undefined> {
  return {
    closed: 'false', severity,
    'first_seen.lt': shiftDay(today, -min + 1),
    'first_seen.gt': max === null ? undefined : shiftDay(today, -max - 1),
  };
}

function VulnerabilitiesByAge() {
  const state = useSource('vulnerabilities') as unknown as FetchState<AgedSummary>;
  return (
    <Panel title="Open vulnerabilities by age" state={state} to="/vulnerabilities/dashboard" linkLabel="Vulnerability dashboard"
      empty={(d) => d.totals.open === 0 || !Array.isArray(d.ageBuckets)} emptyTitle="No open vulnerabilities" emptyMessage="Findings that still need fixing appear here, by how long they have been open.">
      {(d) => {
        const shown = d.severities.filter((s) => d.ageBuckets.some((b) => (b.bySeverity[s.value] ?? 0) > 0));
        const link = (min: number, max: number | null, severity?: string) =>
          `/vulnerabilities${listQuery({ filters: ageFilters(d.today, min, max, severity) })}`;
        return (
          <TableWrap fit label="Open vulnerabilities by age and severity">
            <table className="table">
              <caption className="sr-only">Open vulnerabilities by days since first seen (rows) and severity (columns)</caption>
              <thead>
                <tr>
                  <th scope="col">Open for</th>
                  {shown.map((s) => <th key={s.value} scope="col" className="num">{s.label}</th>)}
                  <th scope="col" className="num" data-priority={1}>Total</th>
                </tr>
              </thead>
              <tbody>
                {d.ageBuckets.map((b) => (
                  <tr key={b.key}>
                    <th scope="row">{b.label}</th>
                    {shown.map((s) => {
                      const n = b.bySeverity[s.value] ?? 0;
                      return <td key={s.value} className="num">{n ? <Link to={link(b.min, b.max, s.value)} aria-label={`${n} ${s.label} open for ${b.label}`}>{n}</Link> : <span className="muted">0</span>}</td>;
                    })}
                    <td className="num">{b.total ? <Link to={link(b.min, b.max)} aria-label={`${b.total} open for ${b.label}`}><strong>{b.total}</strong></Link> : <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        );
      }}
    </Panel>
  );
}

export const VULN_AGE_WIDGETS: WidgetDef[] = [
  {
    id: 'vulnerabilities-age', title: 'Open vulnerabilities by age', group: 'dashboard', sources: ['vulnerabilities'],
    description: 'Open findings by how long they have been open and by severity; each count opens those findings.',
    visible: (ctx) => ctx.sees('vulnerability'), render: () => <VulnerabilitiesByAge />,
  },
];
