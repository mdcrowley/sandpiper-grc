import { LookupChip, RecordPage } from '../../core';
import { AcceptancePanel } from './AcceptancePanel';
import { ActionsPanel } from './ActionsPanel';
import { ScoringPanel } from './ScoringPanel';
import { RatingChip, useScales } from './scales';

export function RiskDetail() {
  const { data: scales } = useScales();
  const scaleOf = (key: unknown) => scales?.find((s) => s.key === key);

  return (
    <RecordPage
      type="risk"
      subtitle={(row) => (
        <span className="row">
          <RatingChip scale={scaleOf(row.scale_key)} rating={row.inherent_rating} prefix="Inherent" />
          <span className="risk-arrow" aria-hidden="true">→</span>
          <span className="sr-only">reduced by controls to</span>
          <RatingChip scale={scaleOf(row.scale_key)} rating={row.residual_rating} prefix="Residual" />
          <span className="muted">Treatment:</span>
          <LookupChip list="risk_treatment" value={row.treatment} />
        </span>
      )}
      summaryFields={[
        'title', 'description', 'category', 'affected', 'cause', 'consequence', 'existing_controls',
        'treatment', 'owner_id', 'due_on', 'review_on', 'status',
      ]}
      tabs={[
        { key: 'scoring', label: 'Scoring', content: (rec) => <ScoringPanel rec={rec} scale={scaleOf(rec.row.scale_key)} /> },
        { key: 'acceptance', label: 'Acceptance', content: (rec) => <AcceptancePanel rec={rec} /> },
        { key: 'actions', label: 'Actions', content: ({ row }) => <ActionsPanel sourceType="risk" sourceId={row.id} source="risk" /> },
      ]}
    />
  );
}
