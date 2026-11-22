// The outside work items of a record (E36-06), as a "Work tracker" tab of its record page (actions, and
// vulnerabilities while that area is on). A host page finds this file at build time, so it still builds
// when the feeds module is left out:
//
//   const useTrackerTab = Object.values(import.meta.glob<{ useTrackerTab: (type: string) => RecordTab | null }>(
//     '../feeds/TrackerLinkPanel.tsx', { eager: true }))[0]?.useTrackerTab ?? (() => null);
//   ...
//   const trackerTab = useTrackerTab('action');   // in the page component; tabs: [...(trackerTab ? [trackerTab] : [])]
//
// The tab is offered only while a work-tracker connection takes this kind of record and its area is on.
import { useState } from 'react';
import { api, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Select, StatusChip, useFetch, useToast } from '../../core';
import type { RecordContext, RecordTab } from '../../core';
import './feeds.css';

/** The Work tracker tab for a record page of `type`, or null while no connection takes that kind of record. */
export function useTrackerTab(type: string): RecordTab | null {
  const available = useFetch<{ available: boolean }>(`/api/tracker/available?record_type=${encodeURIComponent(type)}`);
  if (!available.data?.available) return null;
  return { key: 'work-tracker', label: 'Work tracker', content: ({ row }: RecordContext) => <TrackerLinkPanel recordType={type} recordId={row.id} /> };
}

interface Link {
  id: string; connector_name: string; external_id: string | null; external_url: string | null; external_status: string | null;
  pushed_at: string | null; push_requested_at: string | null; push_error: string | null; synced_at: string | null;
}
interface Links { canSend: boolean; connectors: { id: string; name: string }[]; links: Link[] }

export function TrackerLinkPanel({ recordType, recordId }: { recordType: string; recordId: string }) {
  const toast = useToast();
  const data = useFetch<Links>(`/api/tracker/links?record_type=${encodeURIComponent(recordType)}&record_id=${encodeURIComponent(recordId)}`);
  const [chosen, setChosen] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const d = data.data;
  if (data.error) return <ErrorState title="The work items could not be loaded" error={data.error} onRetry={data.reload} />;
  if (!d) return <Loading label="Loading work items" lines={2} />;
  if (d.links.length === 0 && (!d.canSend || d.connectors.length === 0)) {
    return <EmptyState icon="link" title="Not sent to a work tracker" message={d.canSend ? 'No work-tracker connection that is switched on takes this record.' : 'You can see work items here once someone who may change this record sends it.'} />;
  }
  const target = chosen ?? d.connectors[0]?.id ?? null;

  const send = async () => {
    if (!target) return;
    setSending(true);
    try {
      await api.post('/api/tracker/send', { record_type: recordType, record_id: recordId, connector_id: target });
      toast.success('Queued for the work tracker. It is sent within a minute.');
      setChosen(null);
      data.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card title="Work tracker">
      <div className="tracker-panel">
        {d.links.length > 0 && (
          <ul className="tracker-links" aria-label="Outside work items">
            {d.links.map((l) => (
              <li key={l.id} className="tracker-link">
                <strong>{l.connector_name}</strong>
                {l.external_url && /^https?:\/\//i.test(l.external_url)
                  ? <a href={l.external_url} target="_blank" rel="noopener noreferrer">{l.external_id ?? 'Open the work item'}</a>
                  : l.external_id && <span>{l.external_id}</span>}
                {l.external_status && <StatusChip color="blue" label={l.external_status} />}
                {l.pushed_at
                  ? <span className="muted">Sent {formatDateTime(l.pushed_at)}{l.synced_at ? ` · updated ${formatDateTime(l.synced_at)}` : ''}</span>
                  : l.push_error
                    ? <StatusChip color="red" label={`Not sent yet: ${l.push_error}`} />
                    : <span className="muted">Waiting to be sent</span>}
              </li>
            ))}
          </ul>
        )}
        {d.canSend && d.connectors.length > 0 && (
          <div className="tracker-send">
            {d.connectors.length > 1 && (
              <Select label="Connection" value={target} onChange={setChosen} options={d.connectors.map((c) => ({ value: c.id, label: c.name }))} />
            )}
            <Button icon="external" loading={sending} onClick={() => void send()}>
              {d.connectors.length > 1 ? 'Send to work tracker' : `Send to ${d.connectors[0].name}`}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
