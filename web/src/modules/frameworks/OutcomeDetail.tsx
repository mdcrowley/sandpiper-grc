import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, EditableSummary, RecordPage, errorMessage, useFetch, useLookup, useToast } from '../../core';
import type { ColorName, RecordContext } from '../../core';
import { EvidenceTab } from './EvidenceTab';
import { MappingsTab } from './MappingsTab';

interface OutcomeContext {
  framework: { id: string; name: string; version: string | null } | null;
  function: { code: string; name: string; color: ColorName } | null;
  category: { code: string; name: string; description: string | null } | null;
}

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
      <span className="fw-quick-label">Status</span>
      {statuses.map((s) => (
        <button
          key={s.value} type="button"
          aria-pressed={rec.row.status === s.value}
          disabled={!rec.canEdit || saving !== null}
          onClick={() => choose(s.value)}
          style={{
            '--fw-status-solid': `var(--c-${s.color}-solid)`,
            '--fw-status-bg': `var(--c-${s.color}-bg)`,
            '--fw-status-fg': `var(--c-${s.color}-fg)`,
          } as CSSProperties}
        >
          <span className="fw-quick-dot" />{s.label}
        </button>
      ))}
    </div>
  );
}

function Summary({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const ctx = useFetch<OutcomeContext>(`/api/framework-outcomes/${row.id}/context`).data;
  const place = [
    ctx?.framework && `${ctx.framework.name}${ctx.framework.version ? ` ${ctx.framework.version}` : ''}`,
    ctx?.function && `${ctx.function.name} (${ctx.function.code})`,
    ctx?.category && `${ctx.category.name} (${ctx.category.code})`,
  ].filter(Boolean).join(' › ');
  return (
    <div className="stack">
      <blockquote
        className="fw-official"
        style={ctx?.function ? ({ '--fw-band': `var(--c-${ctx.function.color}-solid)` } as CSSProperties) : undefined}
      >
        <p className="prose">{row.official_text || 'No official text recorded.'}</p>
        <div className="fw-official-source">
          Official text{place ? ` · ${place}` : ''}{row.designation ? ` · designation ${row.designation}` : ''}
        </div>
      </blockquote>
      <EditableSummary
        type="framework_outcome"
        row={row}
        title="Where we are and where we are going"
        fields={['description', 'target', 'first_action', 'phase', 'owner_id', 'review_on', 'priority', 'evidence_summary']}
        onSaved={rec.reload}
      />
    </div>
  );
}

export function OutcomeDetail() {
  return (
    <RecordPage
      type="framework_outcome"
      title={(row) => row.description || row.title || row.code}
      subtitle={(row) => (row.priority ? <Badge color="amber">Priority outcome</Badge> : null)}
      banner={(rec) => <QuickStatus rec={rec} />}
      summary={(rec) => <Summary rec={rec} />}
      tabs={[
        { key: 'evidence', label: 'Evidence', content: (rec) => <EvidenceTab outcome={rec.row} canEdit={rec.canEdit} /> },
        { key: 'mappings', label: 'Also satisfies', content: (rec) => <MappingsTab outcome={rec.row} canEdit={rec.canEdit} /> },
      ]}
      defaultTabs={['links', 'activity', 'history']}
    />
  );
}
