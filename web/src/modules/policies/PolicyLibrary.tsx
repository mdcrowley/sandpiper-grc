// The policies library: every policy with its status and review date, with one-click presets.
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, PageHeader, ResourceList } from '../../core';
import { ReviewChip, isoDay } from './shared';

export interface Preset { key: string; label: string; filter?: Record<string, string> }

/** Buttons that switch a list between ready-made filters; the choice is kept in the page address (`?view=`). */
export function usePresets(presets: Preset[], label: string): [Preset, ReactNode] {
  const [params, setParams] = useSearchParams();
  const active = presets.find((p) => p.key === params.get('view')) ?? presets[0];
  const choose = (key: string) => {
    const next = new URLSearchParams();
    if (key !== presets[0].key) next.set('view', key);
    setParams(next, { replace: true });
  };
  const bar = (
    <div className="pol-presets" role="group" aria-label={label}>
      {presets.map((p) => (
        <Button key={p.key} size="sm" aria-pressed={p.key === active.key} variant={p.key === active.key ? 'primary' : 'secondary'} onClick={() => choose(p.key)}>
          {p.label}
        </Button>
      ))}
    </div>
  );
  return [active, bar];
}

export function PolicyLibrary() {
  const [preset, bar] = usePresets([
    { key: 'all', label: 'All policies' },
    { key: 'published', label: 'Published', filter: { status: 'published' } },
    // Anything not retired whose review date falls in the next 60 days or has passed.
    { key: 'review', label: 'Due for review', filter: { status: 'draft,in_review,approved,published', 'review_date.lt': isoDay(61) } },
    { key: 'drafts', label: 'Drafts', filter: { status: 'draft,in_review,approved' } },
  ], 'Show policies');
  return (
    <div className="stack">
      <PageHeader
        title="Policies"
        subtitle="The policy library: what is in force, what is being written, and what is due for review."
        actions={<Link className="btn btn-secondary" to="/policies/acknowledgements">My acknowledgements</Link>}
      />
      {bar}
      <Card flush>
        <ResourceList
          key={preset.key}
          type="policy"
          columns={[
            'ref', 'title', 'category', 'status',
            { field: 'current_version', label: 'In force', sortable: true, render: (row) => (row.current_version ? `Version ${row.current_version}` : <span className="muted">None</span>) },
            'owner_id',
            { field: 'review_date', label: 'Review', sortable: true, render: (row) => <ReviewChip date={row.review_date} status={row.status} /> },
          ]}
          filters={['status', 'category', 'owner_id', 'review_date']}
          baseFilter={preset.filter}
          defaultSort={preset.key === 'review' ? { field: 'review_date', dir: 'asc' } : undefined}
          createFields={['title', 'summary', 'category', 'owner_id', 'approver_name', 'approver_role', 'review_date']}
        />
      </Card>
    </div>
  );
}
