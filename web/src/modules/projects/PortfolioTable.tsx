import { ResourceList } from '../../core';
import { BudgetBar, RagWithTrend } from './bits';

/** The portfolio register: search, filters, sorting, saved views and export come from ResourceList. */
export function PortfolioTable() {
  return (
    <ResourceList
      type="project"
      columns={[
        'ref',
        'name',
        'tier',
        'stage',
        'status',
        { field: 'rag_overall', label: 'Overall', sortable: true, render: (row) => <RagWithTrend value={row.rag_overall} trend={row.rag_trend} /> },
        { field: 'priority_score', label: 'Score', sortable: true, render: (row) => (row.priority_score === null || row.priority_score === undefined ? '—' : <span className="num">{row.priority_score}</span>) },
        'budget',
        { field: 'spend_to_date', label: 'Spend against budget', sortable: true, render: (row) => <BudgetBar budget={row.budget} spend={row.spend_to_date} /> },
        'project_manager_id',
        'target_on',
      ]}
      filters={[
        'tier', 'stage', 'status', 'rag_overall', 'rag_trend', 'funding_source', 'project_manager_id',
        'touches_payment', 'touches_personal_data', 'touches_operational_systems', 'target_on',
      ]}
    />
  );
}
