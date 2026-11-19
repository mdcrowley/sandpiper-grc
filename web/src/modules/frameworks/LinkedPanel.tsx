// Risks, policies and actions connected to one outcome. Each part appears only when that
// area of the application is loaded and the person may see it (it is then in the metadata).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, RecordPicker, api, errorMessage, recordHref, useFetch, useResource, useToast,
} from '../../core';
import type { Row } from '../../core';
import { ActionsPanel } from '../risks/ActionsPanel';

interface RecordLink { id: string; relation: string; direction: 'out' | 'in'; type: string; recordId: string; label: string; ref: string | null; route: string }

function LinkList({ links, empty }: { links: RecordLink[]; empty: string }) {
  if (!links.length) return <p className="muted fw-linked-empty">{empty}</p>;
  return (
    <ul className="fw-linked">
      {links.map((l) => (
        <li key={l.id}>
          <Link to={recordHref(l.route, l.recordId)}>
            {l.ref && <span className="ref">{l.ref}</span>}
            <span>{l.label}</span>
          </Link>
          <Badge>{l.relation}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function LinkedPanel({ outcome, canEdit }: { outcome: Row; canEdit: boolean }) {
  const toast = useToast();
  const risk = useResource('risk');
  const policy = useResource('policy');
  const action = useResource('action');
  const { data, error, reload } = useFetch<RecordLink[]>(`/api/links?record_type=framework_outcome&record_id=${outcome.id}`);
  const [riskId, setRiskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function linkRisk() {
    if (!riskId) return;
    setBusy(true);
    try {
      await api.post('/api/links', { from_type: 'framework_outcome', from_id: outcome.id, to_type: 'risk', to_id: riskId, relation: 'reduces' });
      setRiskId(null);
      toast.success('Risk linked.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!risk && !policy && !action) {
    return <EmptyState icon="link" title="Nothing to link to here" message="Risks, policies and actions are not available to you, or are not in use. The Related tab links any other record." />;
  }
  const links = data ?? [];

  return (
    <div className="stack">
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={3} label="Loading linked records" /> : (
        <div className="grid-2">
          {risk && (
            <Card title="Risks this outcome reduces">
              <LinkList links={links.filter((l) => l.type === 'risk')} empty="No risk is linked to this outcome yet." />
              {canEdit && (
                <div className="fw-linked-add">
                  <RecordPicker label="Risk" hideLabel type="risk" value={riskId} onChange={(id) => setRiskId(id)} placeholder="Find a risk to link" />
                  <Button icon="plus" disabled={!riskId} loading={busy} onClick={linkRisk}>Link risk</Button>
                </div>
              )}
            </Card>
          )}
          {policy && (
            <Card title="Policies that support this outcome">
              <LinkList links={links.filter((l) => l.type === 'policy')} empty="No policy is mapped to this outcome yet." />
              <p className="muted fw-linked-hint">A policy is mapped to outcomes from the policy’s own page.</p>
            </Card>
          )}
        </div>
      )}
      {action && <ActionsPanel sourceType="framework_outcome" sourceId={outcome.id} source="assessment" />}
    </div>
  );
}
