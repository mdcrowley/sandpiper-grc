// Version history with each version's dates (effective, in force from and to, withdrawn), its
// adoption record and original file, and two versions side by side to compare by reading.
import { useState } from 'react';
import { Card, EmptyState, Select, useAuth } from '../../core';
import { PolicyBody } from './shared';
import { DocVersionChip, VersionFacts, VersionTable, versionName } from './documents/parts';
import type { FullVersion } from './documents/types';

/** One line of facts about a version (kept for the screens that show a single version). */
export function VersionMeta({ v }: { v: FullVersion }) {
  return <VersionFacts v={v} />;
}

function Pane({ label, versions, value, onChange }: { label: string; versions: FullVersion[]; value: string; onChange: (id: string) => void }) {
  const v = versions.find((x) => x.id === value) ?? versions[0];
  return (
    <div className="pol-pane">
      <div className="row">
        <Select label={label} value={v.id} onChange={(id) => onChange(id || v.id)} options={versions.map((x) => ({ value: x.id, label: versionName(x) }))} />
        <DocVersionChip v={v} />
      </div>
      <VersionFacts v={v} />
      {v.content_kind === 'file'
        ? <p className="muted">This version is kept as a file. <a href={`/api/policies/${v.policy_id}/versions/${v.id}/pdf`} target="_blank" rel="noopener">Open it</a>.</p>
        : <PolicyBody html={v.body_html} />}
    </div>
  );
}

export function VersionsPanel({ versions }: { versions: FullVersion[] }) {
  const { can } = useAuth();
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  if (!versions.length) {
    return <Card><EmptyState icon="file-text" title="No versions yet" message="Nothing has been written or uploaded for this document." /></Card>;
  }
  // Newest first. By default the newest is on the right and the one before it on the left.
  const rightId = right || versions[0].id;
  const leftId = left || (versions[1] ?? versions[0]).id;
  const read = (id: string) => {
    setRight(id);
    document.getElementById('pol-compare')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const original = (v: FullVersion) => (can('policies.edit') && v.source_attachment_id ? `/api/policies/${v.policy_id}/versions/${v.id}/original` : null);

  return (
    <div className="stack">
      <Card title="Version history" flush>
        <VersionTable versions={versions} caption="Every version of this document, newest first" onRead={(v) => read(v.id)} original={original} />
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
