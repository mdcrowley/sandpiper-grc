import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, Icon, LookupChip, Modal, RecordPage, ResourceForm, errorMessage, formatDate, toColorName, todayInZone, useFetch,
  useLookup, useToast,
} from '../../core';
import type { ColorName, RecordContext } from '../../core';
import { EvidenceTab } from './EvidenceTab';
import { LinkedPanel } from './LinkedPanel';
import { MappingsTab } from './MappingsTab';
import { OutcomeTimeline } from './OutcomeTimeline';
import { OwnerAvatar } from './StatusBar';
import type { ScaleValue } from './types';
import { frameworkTitle, statusVars } from './types';

interface OutcomeContext {
  framework: { id: string; name: string; version: string | null } | null;
  function: { code: string; name: string; color: ColorName; description: string | null } | null;
  category: { code: string; name: string; description: string | null } | null;
}

const PLAN_FIELDS = ['description', 'target', 'first_action', 'phase', 'owner_id', 'review_on', 'priority', 'evidence_summary'];

/** One click to move an outcome along the status scale. */
function QuickStatus({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const statuses = useLookup('outcome_status');
  const [saving, setSaving] = useState<string | null>(null);

  async function choose(value: string) {
    if (value === rec.row.status || saving) return;
    setSaving(value);
    try {
      await rec.save({ status: value });
      toast.success(`Status set to ${statuses.find((s) => s.value === value)?.label ?? value}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fw-quick" role="group" aria-label="Status">
      <span className="fw-eyebrow">Status</span>
      <div className="fw-quick-steps">
        {statuses.map((s) => (
          <button
            key={s.value} type="button"
            aria-pressed={rec.row.status === s.value}
            disabled={!rec.canEdit || saving !== null}
            onClick={() => choose(s.value)}
            style={statusVars(s.color) as CSSProperties}
          >
            <span className="fw-pill-dot" />{s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pane({ label, children, empty, tone }: { label: string; children: string | null | undefined; empty: string; tone?: 'official' }) {
  return (
    <div className={tone ? 'fw-pane fw-pane-official' : 'fw-pane'}>
      <div className="fw-eyebrow">{label}</div>
      {children ? <p className="prose">{children}</p> : <p className="muted">{empty}</p>}
    </div>
  );
}

function Summary({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const ctx = useFetch<OutcomeContext>(`/api/framework-outcomes/${row.id}/context`).data;
  const statuses = useLookup('outcome_status');
  const [editing, setEditing] = useState(false);
  const review = row.review_on as string | null;
  const overdue = Boolean(review) && review! < todayInZone();
  const band = ctx?.function ? ({ '--fw-band': `var(--c-${ctx.function.color}-solid)` } as CSSProperties) : undefined;

  return (
    <div className="fw-outcome">
      <div className="fw-outcome-main">
        <section className="card fw-texts" style={band} aria-label="Wording">
          <div className="fw-place">
            {ctx?.framework && <span>{frameworkTitle(ctx.framework)}</span>}
            {ctx?.function && <span title={ctx.function.description ?? undefined}><span className="fw-cat-code">{ctx.function.code}</span>{ctx.function.name}</span>}
            {ctx?.category && <span title={ctx.category.description ?? undefined}><span className="fw-cat-code">{ctx.category.code}</span>{ctx.category.name}</span>}
            {row.designation && <span>Designation {row.designation}</span>}
          </div>
          <div className="fw-panes">
            <Pane label="Official text" tone="official" empty="No official text recorded.">{row.official_text}</Pane>
            <Pane label="In plain language" empty="Not written yet. Say what this outcome means for your organization, in your own words.">{row.description}</Pane>
          </div>
        </section>

        <Card
          title="Where we are going"
          actions={rec.canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        >
          <div className="fw-panes">
            <Pane label="Target" empty="No target yet. Describe what “done” looks like.">{row.target}</Pane>
            <Pane label="First action" empty="No first action yet. Name the next concrete step.">{row.first_action}</Pane>
          </div>
          <dl className="fw-facts">
            <div><dt>Phase</dt><dd>{row.phase ? <LookupChip list="outcome_phase" value={row.phase} /> : <span className="muted">Not planned</span>}</dd></div>
            <div>
              <dt>Owner</dt>
              <dd>{row.owner_id
                ? <span className="fw-owner-name"><OwnerAvatar name={row._display?.owner_id ?? 'Owner'} />{row._display?.owner_id}</span>
                : <span className="muted">No owner</span>}</dd>
            </div>
            <div>
              <dt>Review date</dt>
              <dd className={overdue ? 'is-overdue' : undefined}>{review ? `${formatDate(review)}${overdue ? ' (overdue)' : ''}` : <span className="muted">Not set</span>}</dd>
            </div>
            <div><dt>Priority outcome</dt><dd>{row.priority ? <span className="fw-priority"><Icon name="star" size={14} />Yes</span> : 'No'}</dd></div>
          </dl>
        </Card>
      </div>

      <aside className="fw-outcome-side">
        <OutcomeTimeline outcome={row} scale={statuses.map((s): ScaleValue => ({ value: s.value, label: s.label, color: toColorName(s.color), weight: 0 }))} />
      </aside>

      <Modal open={editing} title={`Edit ${row.code}`} size="lg" onClose={() => setEditing(false)}>
        <ResourceForm
          type="framework_outcome" id={row.id} initial={row} fields={PLAN_FIELDS}
          hints={{
            description: 'The outcome in your own words. It becomes the page title and the text on the board.',
            target: 'What “done” looks like for your organization.',
            first_action: 'The next concrete step.',
            review_on: 'The owner is reminded two weeks before this date and again on the day.',
            evidence_summary: 'A sentence or two on what evidence exists overall. Shown at the top of the Evidence tab.',
          }}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); rec.reload(); }}
        />
      </Modal>
    </div>
  );
}

export function OutcomeDetail() {
  return (
    <RecordPage
      type="framework_outcome"
      title={(row) => row.description || row.title || row.code}
      subtitle={(row) => (
        <span className="fw-subtitle">
          {row.priority && <Badge color="amber">Priority outcome</Badge>}
          <Link to={`/frameworks/board/${row.framework_id}`}>Back to the board</Link>
        </span>
      )}
      status={() => null}
      banner={(rec) => <QuickStatus rec={rec} />}
      summary={(rec) => <Summary rec={rec} />}
      tabs={[
        { key: 'evidence', label: 'Evidence', content: (rec) => <EvidenceTab outcome={rec.row} canEdit={rec.canEdit} /> },
        { key: 'mappings', label: 'Also satisfies', content: (rec) => <MappingsTab outcome={rec.row} canEdit={rec.canEdit} onChanged={rec.reload} /> },
        { key: 'linked', label: 'Risks, policies and actions', content: (rec) => <LinkedPanel outcome={rec.row} canEdit={rec.canEdit} /> },
      ]}
      defaultTabs={['links', 'activity', 'history']}
    />
  );
}
