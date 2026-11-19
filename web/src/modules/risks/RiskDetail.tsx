import { useState } from 'react';
import {
  Button, Card, DefinitionList, formatDate, LookupChip, Modal, RecordPage, ResourceForm, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { AcceptancePanel } from './AcceptancePanel';
import { ActionsPanel } from './ActionsPanel';
import { ReviewPanel } from './ReviewPanel';
import { ScoringPanel } from './ScoringPanel';
import { DueChip, RatingChip, useScales, type Scale } from './scales';

const DETAIL_FIELDS = [
  'title', 'description', 'category', 'cause', 'consequence', 'affected', 'existing_controls',
  'treatment', 'owner_id', 'due_on', 'review_on', 'status',
];

/**
 * A risk told top to bottom: what could happen (cause, event, consequence), how serious it is
 * (inherent risk, controls, residual risk), what is being done (treatment and its actions),
 * whether it has been accepted, and when it is next reviewed.
 */
function RiskStory({ rec, scale }: { rec: RecordContext; scale: Scale | undefined }) {
  const { row } = rec;
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const text = (v: unknown, empty: string) => (v ? <p className="prose">{String(v)}</p> : <p className="muted">{empty}</p>);

  return (
    <div className="stack rk-story">
      <Card
        title="The risk"
        actions={rec.canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit details</Button>}
      >
        <ol className="rk-chain" aria-label="Cause, event and consequence">
          <li className="rk-chain-step">
            <p className="rk-step-label">Cause</p>
            {text(row.cause, 'No cause recorded.')}
          </li>
          <li className="rk-chain-step rk-chain-event">
            <p className="rk-step-label">Event</p>
            <p className="rk-chain-title">{row.title}</p>
            {row.description && <p className="prose">{row.description}</p>}
          </li>
          <li className="rk-chain-step">
            <p className="rk-step-label">Consequence</p>
            {text(row.consequence, 'No consequence recorded.')}
          </li>
        </ol>
        <DefinitionList items={[
          { label: 'Category', value: <LookupChip list="risk_category" value={row.category} /> },
          { label: 'Owner', value: row._display?.owner_id ?? 'No owner' },
          { label: 'Affected systems and data', value: row.affected ? <span className="prose">{row.affected}</span> : null, wide: true },
        ]} />
      </Card>

      <ScoringPanel rec={rec} scale={scale} />

      <Card title="Treatment plan">
        <DefinitionList items={[
          { label: 'Treatment', value: <LookupChip list="risk_treatment" value={row.treatment} /> },
          { label: 'Status', value: <LookupChip list="risk_status" value={row.status} /> },
          { label: 'Due', value: row.due_on ? <span className="row">{formatDate(row.due_on)} <DueChip date={row.due_on} done={row.status === 'closed'} /></span> : null },
        ]} />
        <ActionsPanel sourceType="risk" sourceId={row.id} source="risk" />
      </Card>

      {/* The approval rule depends on the rating: fetch it again whenever the scores change. */}
      <AcceptancePanel key={`${row.inherent_rating ?? ''}-${row.residual_rating ?? ''}-${row.scale_key}`} rec={rec} />
      <ReviewPanel rec={rec} />

      <Modal open={editing} title="Edit details" size="lg" onClose={() => setEditing(false)}>
        <ResourceForm
          type="risk"
          id={row.id}
          initial={row}
          fields={DETAIL_FIELDS}
          sections={[
            { title: 'What could happen', fields: ['title', 'description', 'category', 'cause', 'consequence', 'affected'] },
            { title: 'Controls and treatment', fields: ['existing_controls', 'treatment', 'status', 'owner_id', 'due_on', 'review_on'] },
          ]}
          hints={{ status: 'To mark a risk Accepted, record an acceptance instead.', category: 'The category decides which scale the risk is scored on.' }}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); toast.success('Risk saved.'); rec.reload(); }}
        />
      </Modal>
    </div>
  );
}

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
      summary={(rec) => <RiskStory rec={rec} scale={scaleOf(rec.row.scale_key)} />}
    />
  );
}
