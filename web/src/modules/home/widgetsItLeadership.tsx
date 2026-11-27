// Dashboard panels for IT leadership (E45-45): service levels met and the change success rate. Both are
// figures (the same for everyone who may see the area), read from the tickets and changes modules.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ProgressBar, StatusChip, todayInZone, useFetch } from '../../core';
import type { ColorName } from '../../core';
import { addDays } from '../../../../shared/dates.ts';
import { Panel } from './parts';
import type { WidgetDef } from './types';

/** Days both panels look back over. */
const DAYS = 30;

const tone = (pct: number | null, good: number): ColorName => (pct === null ? 'gray' : pct >= good ? 'green' : pct >= good - 15 ? 'amber' : 'red');
const pctText = (pct: number | null) => (pct === null ? 'No figure' : `${pct}%`);

interface SlaMetrics {
  total: number;
  sla: {
    response: { measured: number; breached: number; compliance_pct: number | null };
    resolve: { measured: number; breached: number; compliance_pct: number | null };
    compliance_pct: number | null;
    breaches: number;
  };
}

function ServiceLevelsMet() {
  const from = useMemo(() => addDays(todayInZone(), -(DAYS - 1)), []);
  const state = useFetch<SlaMetrics>(`/api/tickets/metrics?from=${from}`);
  return (
    <Panel
      title="Service levels met" state={state} to="/tickets/dashboard" linkLabel="Service desk dashboard"
      empty={(d) => d.total === 0} emptyIcon="ticket" emptyTitle={`No tickets opened in the last ${DAYS} days`}
    >
      {(d) => (
        <div className="stack">
          <div className="home-lead-figure">
            <span className="home-lead-value">{pctText(d.sla.compliance_pct)}</span>
            <span className="muted">of the {d.total} ticket{d.total === 1 ? '' : 's'} opened in the last {DAYS} days met every target</span>
          </div>
          <ProgressBar label="Responded within target" value={d.sla.response.compliance_pct ?? 0}
            valueText={`${pctText(d.sla.response.compliance_pct)} of ${d.sla.response.measured}`} color={tone(d.sla.response.compliance_pct, 90)} />
          <ProgressBar label="Resolved within target" value={d.sla.resolve.compliance_pct ?? 0}
            valueText={`${pctText(d.sla.resolve.compliance_pct)} of ${d.sla.resolve.measured}`} color={tone(d.sla.resolve.compliance_pct, 90)} />
          {d.sla.breaches > 0 && (
            <p className="muted"><Link to="/tickets?f.target_missed=true">{d.sla.breaches} ticket{d.sla.breaches === 1 ? '' : 's'} missed a target</Link></p>
          )}
        </div>
      )}
    </Panel>
  );
}

interface SuccessRate {
  finished: number; successful: number; unsuccessful: number; success_pct: number | null;
  by_outcome: { value: string; label: string; color: string; count: number; successful: boolean }[];
}

/** Days the change success rate covers. */
const CHANGE_DAYS = 90;

function ChangeSuccessRate() {
  const from = useMemo(() => addDays(todayInZone(), -(CHANGE_DAYS - 1)), []);
  const state = useFetch<SuccessRate>(`/api/changes/success-rate?from=${from}`);
  return (
    <Panel
      title="Change success rate" state={state} to="/changes" linkLabel="Changes"
      empty={(d) => d.finished === 0} emptyIcon="refresh" emptyTitle={`No change has finished in the last ${CHANGE_DAYS} days`}
    >
      {(d) => (
        <div className="stack">
          <div className="home-lead-figure">
            <span className="home-lead-value">{pctText(d.success_pct)}</span>
            <span className="muted">of the {d.finished} change{d.finished === 1 ? '' : 's'} finished in the last {CHANGE_DAYS} days succeeded</span>
          </div>
          <ProgressBar label="Successful" hideLabel value={d.success_pct ?? 0} color={tone(d.success_pct, 95)} />
          <ul className="home-outcomes">
            {d.by_outcome.map((o) => (
              <li key={o.value}>
                <StatusChip color={o.color as ColorName} label={o.label} />
                <Link to={`/changes?f.outcome=${encodeURIComponent(o.value)}`}>{o.count}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export const IT_LEADERSHIP_WIDGETS: WidgetDef[] = [
  {
    id: 'service-levels', title: 'Service levels met', group: 'dashboard',
    description: `Tickets opened in the last ${DAYS} days that met their response and resolution targets.`,
    visible: (ctx) => ctx.sees('ticket'), render: () => <ServiceLevelsMet />,
  },
  {
    id: 'change-success', title: 'Change success rate', group: 'dashboard',
    description: `Changes finished in the last ${CHANGE_DAYS} days that were not failed or backed out.`,
    visible: (ctx) => ctx.sees('change'), render: () => <ChangeSuccessRate />,
  },
];
