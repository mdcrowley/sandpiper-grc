import { useMemo, useState } from 'react';
import { Button, Card, ErrorState, Loading, PageHeader, ResourceList, Select } from '../../core';
import type { Row } from '../../core';
import { HeatMap, type HeatCell } from './HeatMap';
import { RiskSummary } from './RiskSummary';
import { RatingChip, useScales } from './scales';

type Basis = 'residual' | 'inherent';

export function RiskRegister() {
  const { data: scales, error, reload } = useScales();
  const [scaleKey, setScaleKey] = useState('');
  const [basis, setBasis] = useState<Basis>('residual');
  const [drill, setDrill] = useState<{ cell: HeatCell; label: string } | null>(null);

  const active = scaleKey || scales?.[0]?.key || '';
  // Drill-down: the list shows exactly the risks counted in the chosen cell.
  const baseFilter = useMemo(() => (drill ? { id: drill.cell.risk_ids.join(',') } : undefined), [drill]);

  if (error) return <><PageHeader title="Risk register" /><ErrorState error={error} onRetry={reload} /></>;
  if (!scales) return <><PageHeader title="Risk register" /><Loading /></>;

  const scaleOf = (row: Row) => scales.find((s) => s.key === row.scale_key);

  return (
    <div className="stack">
      <PageHeader title="Risk register" subtitle="Restricted: visible only to people with access to security records." />
      <div className="grid-2">
        <Card title="Heat map">
          <div className="risk-toolbar">
            <Select
              label="Scale" value={active}
              options={scales.map((s) => ({ value: s.key, label: s.name }))}
              onChange={(v) => { setScaleKey(v || scales[0]?.key || ''); setDrill(null); }}
            />
            <Select
              label="Show" value={basis}
              options={[{ value: 'residual', label: 'Residual risk (after controls)' }, { value: 'inherent', label: 'Inherent risk (before controls)' }]}
              onChange={(v) => { setBasis(v === 'inherent' ? 'inherent' : 'residual'); setDrill(null); }}
            />
          </div>
          {active && (
            <HeatMap
              scaleKey={active} basis={basis} selected={drill?.cell ?? null}
              onSelect={(cell, label) => setDrill(cell ? { cell, label } : null)}
            />
          )}
        </Card>
        <RiskSummary />
      </div>

      {drill && (
        <div className="risk-drill" role="status">
          <span>
            Showing {drill.cell.count} {drill.cell.count === 1 ? 'risk' : 'risks'} at <strong>{drill.label}</strong> ({basis},{' '}
            {scales.find((s) => s.key === active)?.name}).
          </span>
          <Button size="sm" onClick={() => setDrill(null)}>Show all risks</Button>
        </div>
      )}

      <Card flush>
        <ResourceList
          key={drill ? `${active}-${basis}-${drill.cell.likelihood}-${drill.cell.impact}` : 'all'}
          type="risk"
          columns={[
            'ref', 'title', 'category',
            { field: 'inherent_score', label: 'Inherent', sortable: true, render: (row) => <RatingChip scale={scaleOf(row)} rating={row.inherent_rating} /> },
            { field: 'residual_score', label: 'Residual', sortable: true, render: (row) => <RatingChip scale={scaleOf(row)} rating={row.residual_rating} /> },
            'treatment', 'status', 'owner_id', 'due_on', 'review_on',
          ]}
          filters={['category', 'summary_level', 'status', 'treatment', 'owner_id', 'due_on', 'review_on']}
          baseFilter={baseFilter}
          createFields={['title', 'category', 'description', 'cause', 'consequence', 'affected', 'existing_controls', 'treatment', 'owner_id', 'due_on', 'review_on']}
        />
      </Card>
    </div>
  );
}
