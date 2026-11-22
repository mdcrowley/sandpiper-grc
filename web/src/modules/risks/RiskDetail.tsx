import { lazy, Suspense, useState, type ComponentType } from 'react';
import {
  Button, Card, DefinitionList, ErrorState, formatDate, Loading, LookupChip, Modal, RecordPage, ResourceForm, useFetch, useToast,
} from '../../core';
import type { ListResult, RecordContext, Row } from '../../core';
import { Link } from 'react-router-dom';
import { AcceptancePanel } from './AcceptancePanel';
import { ActionsPanel } from './ActionsPanel';
import { ReviewPanel } from './ReviewPanel';
import { ScoringPanel } from './ScoringPanel';
import { RiskKris } from './KriPages';
import { AppetiteBadge, DueChip, RatingChip, useScales, type Scale } from './scales';

// The controls covering a risk (E26-11), from the control library when it is part of the build. The
// panel renders nothing while the controls area is off or without controls.view.
const controlsLoaders = import.meta.glob<{ ControlsPanel: ComponentType<{ recordType: string; recordId: string }> }>('../controls/ControlsPanel.tsx');
const loadControls = Object.values(controlsLoaders)[0];
const ControlsPanel = loadControls ? lazy(() => loadControls().then((m) => ({ default: m.ControlsPanel }))) : null;

/** E30-08: the enterprise risk this one rolls up under, or the risks that roll up under it. */
function RelatedRisks({ row }: { row: Row }) {
  const { data, error, reload } = useFetch<ListResult>(row.parent_id ? null : `/api/risks?f.parent_id=${encodeURIComponent(row.id)}&sort=residual_score&dir=desc&pageSize=100`);
  const { data: scales } = useScales();
  const scaleOf = (key: unknown) => scales?.find((s) => s.key === key);
  if (row.parent_id) {
    return (
      <Card title="Rolls up under">
        <p style={{ margin: 0 }}><Link to={`/risks/${row.parent_id}`}>{row._display?.parent_id ?? 'The parent risk'}</Link></p>
      </Card>
    );
  }
  if (error) return <Card title="Risks under this one"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Risks under this one"><Loading lines={2} label="Loading risks under this one" /></Card>;
  if (data.rows.length === 0) return null;
  return (
    <Card title={<>Risks under this one <span className="tab-count rk-panel-count">{data.rows.length}</span></>} flush>
      {(
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Risks that roll up under this one</caption>
            <thead><tr><th scope="col">Risk</th><th scope="col">Residual</th><th scope="col">Appetite</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/risks/${c.id}`}><span className="ref">{c.ref}</span> {c.title}</Link></td>
                  <td><RatingChip scale={scaleOf(c.scale_key)} rating={c.residual_rating ?? c.inherent_rating} /></td>
                  <td><AppetiteBadge breach={c.appetite_breach} /></td>
                  <td><LookupChip list="risk_status" value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const DETAIL_FIELDS = [
  'title', 'description', 'category', 'cause', 'consequence', 'affected', 'existing_controls',
  'treatment', 'owner_id', 'due_on', 'review_on', 'status', 'parent_id',
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
          { label: 'Appetite', value: <AppetiteBadge breach={row.appetite_breach} /> },
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

      {ControlsPanel && <Suspense fallback={null}><ControlsPanel recordType="risk" recordId={row.id} /></Suspense>}

      {/* The approval rule depends on the rating: fetch it again whenever the scores change. */}
      <AcceptancePanel key={`${row.inherent_rating ?? ''}-${row.residual_rating ?? ''}-${row.scale_key}`} rec={rec} />
      <ReviewPanel rec={rec} />
      <RelatedRisks row={row} />
      <RiskKris riskId={row.id} />

      <Modal open={editing} title="Edit details" size="lg" onClose={() => setEditing(false)}>
        <ResourceForm
          type="risk"
          id={row.id}
          initial={row}
          fields={DETAIL_FIELDS}
          sections={[
            { title: 'What could happen', fields: ['title', 'description', 'category', 'parent_id', 'cause', 'consequence', 'affected'] },
            { title: 'Controls and treatment', fields: ['existing_controls', 'treatment', 'status', 'owner_id', 'due_on', 'review_on'] },
          ]}
          hints={{ status: 'To mark a risk Accepted, record an acceptance instead.', category: 'The category decides which scale the risk is scored on.', parent_id: 'The enterprise risk this one rolls up under, if any.' }}
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
          {row.appetite_breach && <AppetiteBadge breach />}
        </span>
      )}
      summary={(rec) => <RiskStory rec={rec} scale={scaleOf(rec.row.scale_key)} />}
    />
  );
}
