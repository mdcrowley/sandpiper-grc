// Duplicate findings (E10-16): findings recorded before host and port matching that are now the
// same finding (same host, port and identifier). An administrator of vulnerabilities picks the
// one to keep in each group and merges the others into it; comments, files, links, tags and
// watchers move across and the merge is recorded in the kept finding's history.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, PageHeader, StatusChip, useFetch, useToast,
} from '../../core';
import { SectionTabs, SeverityChip } from './shared';

interface DupFinding {
  id: string; ref: string; title: string; host_name: string | null; host_ip: string | null; port: string | null;
  severity: string; status: string; status_label: string; closed: boolean; first_seen: string | null; last_seen: string | null;
  owner_name: string | null; comments: number; files: number;
}
interface Group { key: string; host: string; port: string | null; finding: string; title: string; findings: DupFinding[] }
interface Report { groups: Group[]; findings: number; can_merge: boolean }

function GroupCard({ group, canMerge, onMerged }: { group: Group; canMerge: boolean; onMerged: () => void }) {
  const toast = useToast();
  const [keep, setKeep] = useState(group.findings[0].id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const kept = group.findings.find((f) => f.id === keep)!;
  const others = group.findings.filter((f) => f.id !== keep);

  async function merge() {
    setBusy(true);
    try {
      await api.post('/api/vulnerabilities/duplicates/merge', { keep_id: keep, merge_ids: others.map((f) => f.id) });
      toast.success(`${others.map((f) => f.ref).join(', ')} merged into ${kept.ref}.`);
      onMerged();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirming(false);
    }
  }

  const name = `vuln-dup-${group.key.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <Card
      title={<span className="vuln-dup-title">{group.title}</span>}
      actions={canMerge && <Button size="sm" variant="primary" onClick={() => setConfirming(true)}>Merge into {kept.ref}</Button>}
      flush
    >
      <p className="muted vuln-dup-key">Host <strong>{group.host}</strong> · port <strong>{group.port ?? 'none'}</strong> · finding <strong>{group.finding}</strong></p>
      <div className="table-wrap vuln-tw">
        <table className="table">
          <caption className="sr-only">Findings with the same host, port and identifier{canMerge ? '; choose the one to keep' : ''}</caption>
          <thead>
            <tr>
              {canMerge && <th scope="col">Keep</th>}
              <th scope="col">Finding</th><th scope="col">Recorded as</th><th scope="col">Severity</th><th scope="col">Status</th>
              <th scope="col">First seen</th><th scope="col">Last seen</th><th scope="col">Owner</th>
              <th scope="col" className="num">Comments</th><th scope="col" className="num">Files</th>
            </tr>
          </thead>
          <tbody>
            {group.findings.map((f) => (
              <tr key={f.id}>
                {canMerge && (
                  <td>
                    <input type="radio" name={name} checked={keep === f.id} onChange={() => setKeep(f.id)} aria-label={`Keep ${f.ref}`} />
                  </td>
                )}
                <th scope="row"><Link to={`/vulnerabilities/${f.id}`}>{f.ref}</Link></th>
                <td>{[f.host_name, f.host_ip].filter(Boolean).join(' · ') || '—'}{f.port ? ` · ${f.port}` : ''}</td>
                <td><SeverityChip value={f.severity} /></td>
                <td><StatusChip color={f.closed ? 'gray' : 'blue'} label={f.status_label} size="sm" /></td>
                <td>{f.first_seen ? formatDate(f.first_seen) : '—'}</td>
                <td>{f.last_seen ? formatDate(f.last_seen) : '—'}</td>
                <td>{f.owner_name ?? <span className="muted">—</span>}</td>
                <td className="num">{f.comments}</td>
                <td className="num">{f.files}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={confirming} title={`Merge into ${kept.ref}?`} confirmLabel="Merge" busy={busy}
        message={`${others.map((f) => f.ref).join(', ')} will be removed. Their comments, files, links, tags and watchers move to ${kept.ref}, which keeps its own status and owner and takes the earliest first-seen and latest last-seen dates. The merge is recorded in ${kept.ref}'s history with the details of the findings removed.`}
        onCancel={() => setConfirming(false)} onConfirm={() => void merge()}
      />
    </Card>
  );
}

export function DuplicatesPage() {
  const { data, error, reload } = useFetch<Report>('/api/vulnerabilities/duplicates');
  return (
    <div className="stack">
      <PageHeader
        title="Duplicate findings"
        subtitle="Findings with the same host, port and identifier, left from before the import matched hosts by name and address and kept ports apart."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Duplicates' }]}
      />
      <SectionTabs active="findings" />
      {error && !data ? <ErrorState title="The duplicates could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Looking for duplicates" />
        : data.groups.length === 0 ? (
          <Card><EmptyState icon="check-circle" title="No duplicate findings" message="Every open or closed finding has its own host, port and identifier." /></Card>
        ) : (
          <>
            <p className="muted">
              {data.groups.length} group{data.groups.length === 1 ? '' : 's'}, {data.findings} findings. The first finding of each group, an open one seen most recently, is suggested to keep.
              {!data.can_merge && ' Merging needs the Administer permission on vulnerabilities.'}
            </p>
            {data.groups.map((g) => <GroupCard key={g.key} group={g} canMerge={data.can_merge} onMerged={reload} />)}
          </>
        )}
    </div>
  );
}
