// Every measure of the strategic plans, with its latest actual against the target for that period.
import { PageHeader, ResourceList } from '../../core';

export function MeasureList() {
  return (
    <div className="stack">
      <PageHeader title="Strategic measures" subtitle="The measures (key performance indicators) of every objective: unit, direction, baseline, and the latest actual against its target. Open one to enter targets and actuals by period." />
      <ResourceList
        type="strategic_measure"
        urlState
        columns={[
          'ref', 'title', { field: 'objective_id', priority: 2 }, { field: 'unit', priority: 3 }, { field: 'baseline_value', priority: 3 },
          { field: 'latest_period', priority: 2 }, 'latest_target', 'latest_value', 'latest_state', { field: 'source', priority: 3 }, { field: 'owner_id', priority: 3 },
          { field: 'plan_id', hidden: true }, { field: 'frequency', hidden: true },
        ]}
        filters={['plan_id', 'objective_id', 'latest_state', 'source', 'frequency', 'owner_id']}
      />
    </div>
  );
}
