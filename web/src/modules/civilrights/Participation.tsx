// Business participation: goals per period with attainment, shortfall analysis and good-faith efforts,
// the awards of each period with their participating firms, and the period's report data as CSV.
import {
  Button, Card, EditableSummary, ErrorState, formatCurrency, KeyValue, Loading, PageHeader, ProgressBar, RecordPage,
  ResourceList, StatusChip, TableWrap, useAuth, useFetch,
} from '../../core';
import type { Row } from '../../core';
import { Link } from 'react-router-dom';
import { ChildTable, type ChildField } from './ChildTable';
import { pct, type Attainment } from './shared';
import './civilrights.css';

const GOAL_CREATE = ['title', 'program_id', 'period_label', 'period_start', 'period_end', 'goal_pct', 'owner_id', 'method_notes'];
const AWARD_COLUMNS = ['ref', 'title', 'contract_id', 'prime_vendor_id', 'awarded_on', 'award_amount'];
const AWARD_CREATE = ['title', 'goal_id', 'contract_id', 'prime_vendor_id', 'awarded_on', 'award_amount', 'notes'];

function MetChip({ a }: { a: Pick<Attainment, 'met' | 'attainment_pct'> }) {
  if (a.met === null) return <StatusChip size="sm" color="gray" label={a.attainment_pct == null ? 'No awards yet' : 'No goal set'} />;
  return <StatusChip size="sm" color={a.met ? 'green' : 'amber'} label={a.met ? 'Goal met' : 'Below goal'} />;
}

function AttainmentTable() {
  const { data, error, reload } = useFetch<Attainment[]>('/api/civil-rights/attainment');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  if (!data.length) return null;
  return (
    <Card title="Attainment by period" flush>
      <TableWrap fit label="Attainment by period">
        <table className="table">
          <caption className="sr-only">Attainment by period</caption>
          <thead><tr>
            <th scope="col" data-priority={1}>Goal</th><th scope="col" data-priority={2}>Period</th><th scope="col" data-priority={1}>Goal</th>
            <th scope="col" data-priority={1}>Attained</th><th scope="col" data-priority={3}>Awards</th><th scope="col" data-priority={2}>Certified firms</th>
            <th scope="col" data-priority={1}>State</th>
          </tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.goal_id}>
                <td className="cr-wrap"><Link to={`/civil-rights/goals/${a.goal_id}`}>{a.ref && <span className="ref">{a.ref}</span>} {a.title}</Link></td>
                <td>{a.period_label ?? ''}</td>
                <td>{pct(a.goal_pct)}</td>
                <td>{pct(a.attainment_pct)}</td>
                <td>{formatCurrency(a.award_total)}</td>
                <td>{formatCurrency(a.certified_total)}</td>
                <td><MetChip a={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

export function GoalList() {
  return (
    <div className="stack">
      <PageHeader title="Participation goals" subtitle="A goal for each period, the awards that count toward it and how much went to certified firms." />
      <AttainmentTable />
      <ResourceList type="participation_goal" urlState columns={['ref', 'title', 'program_id', 'period_label', 'period_start', 'period_end', 'goal_pct', 'status']}
        filters={['status', 'program_id', 'period_start']} createFields={GOAL_CREATE} />
    </div>
  );
}

function AttainmentCard({ goal }: { goal: Row }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Attainment>(`/api/civil-rights/goals/${goal.id}/attainment?v=${goal.updated_at}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <Card title="Attainment" actions={can('civilrights.export') && (
      <Button size="sm" icon="download" onClick={() => { window.location.href = `/api/civil-rights/goals/${goal.id}/export`; }}>Report data (CSV)</Button>
    )}>
      <div className="cr-stack">
        <div><MetChip a={data} /></div>
        {data.attainment_pct != null && (
          <ProgressBar value={Math.min(100, data.attainment_pct)} max={Math.max(100, data.goal_pct ?? 0)} label="Attained" valueText={pct(data.attainment_pct)}
            color={data.met ? 'green' : 'amber'} />
        )}
        <KeyValue items={[
          { label: 'Goal', value: pct(data.goal_pct) },
          { label: 'Attained', value: pct(data.attainment_pct) },
          ...(data.shortfall_pct ? [{ label: 'Shortfall', value: pct(data.shortfall_pct) }] : []),
          { label: 'Awards', value: `${data.awards}, ${formatCurrency(data.award_total)}` },
          { label: 'To participating firms', value: formatCurrency(data.participation_total) },
          { label: 'To certified firms', value: formatCurrency(data.certified_total) },
        ]} />
      </div>
    </Card>
  );
}

export function GoalDetail() {
  return (
    <RecordPage
      type="participation_goal"
      summary={({ row, reload }) => (
        <div className="cr-summary">
          <EditableSummary type="participation_goal" row={row} onSaved={reload} title="Goal"
            fields={['title', 'program_id', 'period_label', 'period_start', 'period_end', 'goal_pct', 'status', 'owner_id', 'method_notes']} />
          <AttainmentCard goal={row} />
        </div>
      )}
      tabs={[
        {
          key: 'awards', label: 'Awards',
          content: ({ row }) => (
            <ResourceList type="participation_award" baseFilter={{ goal_id: String(row.id) }} urlState={false}
              columns={AWARD_COLUMNS} createFields={AWARD_CREATE.filter((f) => f !== 'goal_id')} createInitial={{ goal_id: row.id }} />
          ),
        },
        {
          key: 'shortfall', label: 'Shortfall and good faith',
          content: ({ row, reload }) => (
            <EditableSummary type="participation_goal" row={row} onSaved={reload} title="Shortfall and good-faith efforts" fields={['shortfall_analysis', 'good_faith_notes']} />
          ),
        },
      ]}
    />
  );
}

export function AwardList() {
  return (
    <div className="stack">
      <PageHeader title="Participation awards" subtitle="Contracts and awards with the firms taking part in each, certified or not." />
      <ResourceList type="participation_award" urlState columns={['ref', 'title', 'goal_id', 'contract_id', 'prime_vendor_id', 'awarded_on', 'award_amount']}
        filters={['goal_id', 'contract_id', 'prime_vendor_id', 'awarded_on']} createFields={AWARD_CREATE} />
    </div>
  );
}

function FirmsTab({ award }: { award: Row }) {
  const { can } = useAuth();
  const fields: ChildField[] = [
    ...(can('vendors.view') ? [{ name: 'vendor_id', label: 'Vendor', kind: 'ref' as const, to: 'vendor', hint: 'A vendor of the register, or leave empty and give the firm\'s name.' }] : []),
    { name: 'firm_name', label: 'Firm name', kind: 'text' },
    { name: 'certified', label: 'Certified firm', kind: 'bool', hint: 'Counts toward the goal.' },
    { name: 'role', label: 'Role', kind: 'text', hint: 'Prime, subcontractor or supplier.' },
    { name: 'amount', label: 'Amount', kind: 'number' },
    { name: 'note', label: 'Note', kind: 'longtext' },
  ];
  return (
    <ChildTable url={`/api/civil-rights/awards/${award.id}/firms`} title="Participating firms" noun="firm" fields={fields} canEdit={can('civilrights.edit')}
      emptyTitle="No participating firms yet" emptyMessage="Add each firm taking part in the award, with its amount and whether it is certified."
      columns={[
        { label: 'Firm', priority: 1, render: (r) => r.vendor_id_label ?? r.firm_name ?? '' },
        { label: 'Certified', priority: 1, render: (r) => (r.certified ? <StatusChip size="sm" color="green" label="Certified" /> : <span className="muted">No</span>) },
        { label: 'Role', priority: 3, render: (r) => r.role ?? '' },
        { label: 'Amount', priority: 1, render: (r) => formatCurrency(r.amount) },
      ]}
      footer={(rows) => {
        const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const certified = rows.filter((r) => r.certified).reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const base = Number(award.award_amount ?? 0);
        return <p className="cr-total muted">To firms {formatCurrency(total)}; to certified firms {formatCurrency(certified)}{base > 0 ? ` (${pct(Math.round((certified / base) * 1000) / 10)} of the award)` : ''}.</p>;
      }}
    />
  );
}

export function AwardDetail() {
  return (
    <RecordPage type="participation_award" summaryFields={['title', 'goal_id', 'contract_id', 'prime_vendor_id', 'awarded_on', 'award_amount', 'notes']}
      tabs={[{ key: 'firms', label: 'Participating firms', content: ({ row }) => <FirmsTab award={row} /> }]} />
  );
}

