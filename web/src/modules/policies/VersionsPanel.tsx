// Version history, and two versions side by side to compare by reading.
import { useState } from 'react';
import { Button, Card, EmptyState, Select, formatDate, formatDateTime } from '../../core';
import { PolicyBody, VersionChip, type PolicyVersion } from './shared';

export function VersionMeta({ v }: { v: PolicyVersion }) {
  return (
    <p className="pol-meta">
      {v.approved_by_name && <span>Approved by {v.approved_by_name}{v.approved_on ? ` on ${formatDate(v.approved_on)}` : ''}</span>}
      {v.effective_on && <span>Effective {formatDate(v.effective_on)}</span>}
      {v.published_at && <span>Published {formatDateTime(v.published_at)}</span>}
      {!v.approved_by_name && <span>Written {formatDate(v.created_at)}{v.author_name ? ` by ${v.author_name}` : ''}</span>}
      {v.change_summary && <span>Change: {v.change_summary}</span>}
    </p>
  );
}

function Pane({ label, versions, value, onChange }: { label: string; versions: PolicyVersion[]; value: string; onChange: (id: string) => void }) {
  const v = versions.find((x) => x.id === value) ?? versions[0];
  return (
    <div className="pol-pane">
      <div className="row">
        <Select
          label={label} value={v.id} onChange={(id) => onChange(id || v.id)}
          options={versions.map((x) => ({ value: x.id, label: `Version ${x.version}` }))}
        />
        <VersionChip status={v.status} />
      </div>
      <VersionMeta v={v} />
      <PolicyBody html={v.body_html} />
    </div>
  );
}

export function VersionsPanel({ versions }: { versions: PolicyVersion[] }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  if (!versions.length) {
    return <Card><EmptyState icon="file-text" title="No versions yet" message="Nothing has been published for this policy." /></Card>;
  }
  // Newest first. By default the newest is on the right and the one before it on the left.
  const rightId = right || versions[0].id;
  const leftId = left || (versions[1] ?? versions[0]).id;
  const read = (id: string) => {
    setRight(id);
    document.getElementById('pol-compare')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="stack">
      <Card title="Version history" flush>
        <div className="table-wrap pol-tw">
          <table className="table">
            <caption className="sr-only">Every version of this policy, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Version</th><th scope="col">Status</th><th scope="col">What changed</th>
                <th scope="col">Approved by</th><th scope="col">Approved</th><th scope="col">Effective</th><th scope="col"><span className="sr-only">Read</span></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="pol-rowhead">Version {v.version}</td>
                  <td><VersionChip status={v.status} /></td>
                  <td className="pol-wrap">{v.change_summary ?? <span className="muted">—</span>}</td>
                  <td>{v.approved_by_name ?? <span className="muted">—</span>}</td>
                  <td>{formatDate(v.approved_on)}</td>
                  <td>{formatDate(v.effective_on)}</td>
                  <td><Button size="sm" variant="ghost" icon="eye" onClick={() => read(v.id)}>Read</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section id="pol-compare" className="stack" aria-label="Read and compare versions">
        <p className="muted">
          {versions.length > 1
            ? 'Read two versions side by side to see what changed. Older versions are kept exactly as they were approved.'
            : 'This is the only version so far. When a new one is written you can read the two side by side here.'}
        </p>
        {versions.length > 1 ? (
          <div className="pol-compare">
            <Pane label="Earlier version" versions={versions} value={leftId} onChange={setLeft} />
            <Pane label="Later version" versions={versions} value={rightId} onChange={setRight} />
          </div>
        ) : (
          <Pane label="Version" versions={versions} value={rightId} onChange={setRight} />
        )}
      </section>
    </div>
  );
}
