import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Button, Card, DefinitionList, errorMessage, formatDate, ResourceList, RecordPage, useAuth, useFetch, useLookup, useToast } from '../../core';
import type { RecordContext } from '../../core';
import type { AppetiteData } from './Appetite';

// E46-53: one change of the risk appetite sent for approval (RAC- numbers). What was asked for cannot
// be edited; the approval workflow panel on the page decides it, and the person who asked (or someone
// who administers risks) can withdraw it while it waits.

function Summary({ row }: RecordContext) {
  // The rating's name on the category's scale (the request keeps its key).
  const { data } = useFetch<AppetiteData>('/api/risks/appetite');
  const ratingLabel = row.max_rating
    ? (data?.categories.find((c) => c.category === row.category)?.ratings.find((r) => r.key === row.max_rating)?.label ?? String(row.max_rating))
    : null;
  const statuses = useLookup('risk_appetite_change_status');
  const status = statuses.find((s) => s.value === row.status);
  return (
    <Card title="What was asked for">
      <DefinitionList items={[
        { label: 'Category', value: row._display?.category ?? row.category },
        { label: 'Change', value: row.remove_appetite ? 'Remove the appetite' : 'A new appetite' },
        ...(row.remove_appetite ? [] : [
          { label: 'Appetite statement', value: row.statement ?? <span className="muted">No statement</span>, wide: true },
          { label: 'Highest acceptable rating', value: ratingLabel ?? 'No limit' },
          { label: 'Highest acceptable score', value: row.max_score ?? <span className="muted">None</span> },
        ]),
        { label: 'Why it should change', value: row.reason ?? '—', wide: true },
        { label: 'Asked for by', value: row._display?.requested_by ?? <span className="muted">Unknown</span> },
        { label: 'Asked on', value: formatDate(row.created_at) },
        { label: 'Status', value: status?.label ?? row.status },
        ...(row.decided_on ? [{ label: 'Decided', value: `${formatDate(row.decided_on)}${row.decided_by_name ? ` by ${row.decided_by_name}` : ''}` }] : []),
        ...(row.version ? [{ label: 'Version recorded', value: <Link to="/risks/appetite">Version {row.version}</Link> }] : []),
        ...(row.decision_note ? [{ label: 'Decision note', value: row.decision_note, wide: true }] : []),
      ]} />
    </Card>
  );
}

function Withdraw({ row, reload }: RecordContext) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (row.status !== 'awaiting_approval' || !(can('risks.administer') || row.requested_by === user?.id)) return null;
  return (
    <Button loading={busy} onClick={async () => {
      setBusy(true);
      try { await api.post(`/api/risks/appetite/changes/${row.id}/withdraw`, {}); toast.success(`${row.ref} withdrawn.`); reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
    }}>Withdraw</Button>
  );
}

export function AppetiteChangeDetail() {
  return (
    <RecordPage
      type="risk_appetite_change"
      breadcrumbs={[{ label: 'Risk appetite', to: '/risks/appetite' }, { label: 'Changes sent for approval', to: '/risks/appetite/changes' }]}
      summary={(rec) => <Summary {...rec} />}
      actions={(rec) => <Withdraw {...rec} />}
      tags={false}
    />
  );
}

export function AppetiteChangeList() {
  return (
    <ResourceList
      type="risk_appetite_change"
      title="Risk appetite changes"
      columns={['ref', 'title', 'status', 'requested_by', 'created_at', 'decided_on', 'version']}
      filters={['status', 'category']}
    />
  );
}
