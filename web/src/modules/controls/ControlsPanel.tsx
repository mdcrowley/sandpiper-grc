// The controls covering one record, for that record's own page (a risk, hazard, framework outcome,
// obligation or policy). Host pages load it with import.meta.glob, so a build without the control
// library shows no panel:
//
//   const loaders = import.meta.glob<{ ControlsPanel: ComponentType<ControlsPanelProps> }>('../controls/ControlsPanel.tsx');
//   <ControlsPanel recordType="risk" recordId={row.id} />
//
// It renders nothing without controls.view or while the control library is switched off.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, useAuth, useFetch } from '../../core';
import { StateChip, type CoverState } from './shared';
import './controls.css';

export interface ControlsPanelProps {
  /** The covered record's type: risk, hazard, framework_outcome, obligation or policy. */
  recordType: string;
  recordId: string;
}

interface Covering {
  state: CoverState | null;
  rows: { link_id: string; id: string; ref: string; title: string; key_control: boolean; operating_rating: string | null; next_test_due: string | null; state: CoverState | null }[];
}

export function ControlsPanel({ recordType, recordId }: ControlsPanelProps) {
  const { can, areaOn } = useAuth();
  const on = areaOn('controls') && can('controls.view');
  const { data, error, reload } = useFetch<Covering>(on ? `/api/controls/covering?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(recordId)}` : null);
  if (!on) return null;
  return (
    <Card title="Controls" actions={data?.state ? <StateChip state={data.state} /> : undefined} flush>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="ctl-pad"><Loading lines={2} label="Loading the controls covering this record" /></div>
        : data.rows.length === 0 ? <EmptyState icon="shield" title="No controls linked" message="Link a control to this record from the control's Coverage tab." />
        : (
          <ul className="ctl-due">
            {data.rows.map((c) => (
              <li key={c.link_id}>
                <Link to={`/controls/${c.id}`}><span className="ref">{c.ref}</span> {c.title}</Link>
                <span className="row">
                  {c.operating_rating && <LookupChip list="control_test_result" value={c.operating_rating} />}
                  <StateChip state={c.state} />
                  {c.next_test_due && <span className="muted">Next test {formatDate(c.next_test_due)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

export default ControlsPanel;
