// Pieces shared by the reading page and the record page of a document: version dates, the version
// table, the hierarchy around a document and its relationships. Hidden documents are counted, never
// named: "2 more you cannot open".
import { Link } from 'react-router-dom';
import {
  Badge, Card, EmptyState, ErrorState, formatDate, Icon, Loading, StatusChip, TableWrap, useFetch,
} from '../../../core';
import type { ColorName } from '../../../core';
import {
  docNumber, readerPath, type DocVersion, type Hierarchy, type HierarchyNode, type Relationships,
} from './types';

export const DOC_VERSION_STATUS: Record<DocVersion['status'], { label: string; color: ColorName }> = {
  draft: { label: 'Draft', color: 'gray' },
  in_review: { label: 'In review', color: 'amber' },
  approved: { label: 'Approved', color: 'blue' },
  published: { label: 'Effective', color: 'green' },
  superseded: { label: 'Superseded', color: 'red' },
  withdrawn: { label: 'Withdrawn', color: 'purple' },
};

export function DocVersionChip({ v }: { v: Pick<DocVersion, 'status' | 'scheduled'> }) {
  if (v.status === 'approved' && v.scheduled) return <StatusChip color="blue" label="Scheduled" />;
  const s = DOC_VERSION_STATUS[v.status] ?? DOC_VERSION_STATUS.draft;
  return <StatusChip color={s.color} label={s.label} />;
}

/** "Version 3" or "Rev. C (version 3)". */
export const versionName = (v: Pick<DocVersion, 'version' | 'version_label'>) =>
  (v.version_label ? `${v.version_label} (version ${v.version})` : `Version ${v.version}`);

/** When a version applied: "Effective from 2026-03-01", "In force 2024-01-10 to 2026-02-28", "Approved, effective on …". */
export function versionDates(v: DocVersion): string {
  const from = v.effective_on ?? v.published_at?.slice(0, 10) ?? null;
  if (v.status === 'published') return from ? `Effective from ${formatDate(from)}` : 'Effective';
  if (v.status === 'approved' && v.scheduled && v.effective_on) return `Approved, effective on ${formatDate(v.effective_on)}`;
  if (v.status === 'superseded') {
    return from && v.superseded_on ? `In force ${formatDate(from)} to ${formatDate(v.superseded_on)}`
      : v.superseded_on ? `Superseded on ${formatDate(v.superseded_on)}` : 'Superseded';
  }
  if (v.status === 'withdrawn') {
    return from && v.withdrawn_on ? `In force ${formatDate(from)} to ${formatDate(v.withdrawn_on)}, then withdrawn`
      : v.withdrawn_on ? `Withdrawn on ${formatDate(v.withdrawn_on)}` : 'Withdrawn';
  }
  if (v.status === 'approved') return v.approved_on ? `Approved on ${formatDate(v.approved_on)}, not yet effective` : 'Approved, not yet effective';
  return v.status === 'in_review' ? 'In review' : 'Draft';
}

/** The facts of one version on a line: dates, approval, adoption record, what changed. */
export function VersionFacts({ v }: { v: DocVersion }) {
  return (
    <p className="pol-meta">
      <span><strong>{versionDates(v)}</strong></span>
      {v.approved_by_name && <span>Approved by {v.approved_by_name}{v.approved_on ? ` on ${formatDate(v.approved_on)}` : ''}</span>}
      {v.approval_body && <span>Adopted by {v.approval_body}{v.approval_reference ? `, ${v.approval_reference}` : ''}</span>}
      {!v.approval_body && v.approval_reference && <span>Approval record: {v.approval_reference}</span>}
      {v.reviewed_no_change_on && <span>Reviewed {formatDate(v.reviewed_no_change_on)}, no change</span>}
      {v.minor && <span>Minor change</span>}
      {v.change_summary && <span>Change: {v.change_summary}</span>}
    </p>
  );
}

/** Every version with its dates, newest first. `onRead` picks one to read. */
export function VersionTable<V extends DocVersion>({ versions, onRead, caption, readLabel = 'Read', original }: {
  versions: V[]; onRead?: (v: V) => void; caption: string; readLabel?: string;
  /** Link to the original file of a version (editors only). */
  original?: (v: V) => string | null;
}) {
  if (!versions.length) return <EmptyState icon="file-text" title="No versions yet" message="Nothing has been issued for this document." />;
  return (
    <TableWrap label={caption} className="pol-tw" fit>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" data-priority="1">Version</th>
            <th scope="col" data-priority="1">Status</th>
            <th scope="col" data-priority="1">In force</th>
            <th scope="col" data-priority="2">Approved</th>
            <th scope="col" data-priority="3">Adoption record</th>
            <th scope="col" data-priority="2">What changed</th>
            {(onRead || original) && <th scope="col" data-priority="1"><span className="sr-only">Open</span></th>}
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const file = original?.(v);
            return (
              <tr key={v.id}>
                <td className="pol-rowhead">{versionName(v)}{v.minor ? <span className="muted"> (minor)</span> : null}</td>
                <td><DocVersionChip v={v} /></td>
                <td className="pol-wrap">{versionDates(v)}</td>
                <td>{v.approved_on ? `${formatDate(v.approved_on)}${v.approved_by_name ? `, ${v.approved_by_name}` : ''}` : <span className="muted">—</span>}</td>
                <td className="pol-wrap">{[v.approval_body, v.approval_reference].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                <td className="pol-wrap">{v.change_summary ?? <span className="muted">—</span>}</td>
                {(onRead || original) && (
                  <td>
                    <span className="row doc-row-actions">
                      {onRead && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRead(v)}>{readLabel}<span className="sr-only"> {versionName(v)}</span></button>}
                      {file && <a className="btn btn-ghost btn-sm" href={file}>Original<span className="sr-only"> file of {versionName(v)}</span></a>}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function NodeLink({ n, to }: { n: HierarchyNode; to: (id: string) => string }) {
  return (
    <span className="doc-node">
      {docNumber(n) && <span className="doc-number">{docNumber(n)}</span>}
      <Link to={to(n.id)}>{n.title}</Link>
      {(n.status === 'retired' || n.retired_on) && <StatusChip size="sm" color="purple" label="Obsolete" />}
    </span>
  );
}

const hiddenPhrase = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'} you cannot open`;

/** The documents above and below this one, limited to what the viewer can read. */
export function HierarchyPanel({ id, to = readerPath }: { id: string; to?: (id: string) => string }) {
  const { data, error, reload } = useFetch<Hierarchy>(`/api/policies/${id}/hierarchy`);
  if (error) return <Card title="Place in the hierarchy"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Place in the hierarchy"><Loading lines={3} /></Card>;
  const { ancestors, children, hidden_children: hidden } = data;
  return (
    <Card title="Place in the hierarchy">
      <div className="stack">
        {data.tier_warning && <p className="notice notice-warn">{data.tier_warning}</p>}
        <ol className="doc-tree" aria-label="From the top of the hierarchy to this document">
          {ancestors.map((a, i) => (
            <li key={a.id} style={{ ['--depth' as string]: i }}><NodeLink n={a} to={to} /></li>
          ))}
          <li style={{ ['--depth' as string]: ancestors.length }} aria-current="page">
            <span className="doc-node doc-node-self">
              {docNumber(data.document) && <span className="doc-number">{docNumber(data.document)}</span>}
              <strong>{data.document.title}</strong>
            </span>
            {(children.length > 0 || hidden > 0) && (
              <ul className="doc-tree-children" aria-label="Documents under this one">
                {children.map((c) => (
                  <li key={c.id}>
                    <NodeLink n={c} to={to} />
                    {c.child_count ? <span className="muted doc-small"> {c.child_count} under it</span> : null}
                  </li>
                ))}
                {hidden > 0 && <li className="muted"><Icon name="lock" size={14} /> {hiddenPhrase(hidden)}</li>}
              </ul>
            )}
          </li>
        </ol>
        {!ancestors.length && !children.length && !hidden && <p className="muted">This document has no parent and nothing under it.</p>}
      </div>
    </Card>
  );
}

/** Linked records grouped by relation. Links to records the viewer cannot open are only counted. */
export function RelationshipsPanel({ id }: { id: string }) {
  const { data, error, reload } = useFetch<Relationships>(`/api/policies/${id}/relationships`);
  if (error) return <Card title="Linked records"><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card title="Linked records"><Loading lines={3} /></Card>;
  const groups = data.groups.filter((g) => g.items.length || g.hidden);
  if (!groups.length) {
    return <Card title="Linked records"><EmptyState icon="link" title="Nothing linked" message="Controls, obligations, systems, courses and other documents linked to this one appear here." /></Card>;
  }
  return (
    <Card title="Linked records">
      <div className="doc-rel">
        {groups.map((g) => (
          <section key={g.relation} aria-label={g.label}>
            <h3 className="doc-rel-title">{g.label} <Badge color="gray">{g.items.length + g.hidden}</Badge></h3>
            <ul>
              {g.items.map((it) => (
                <li key={`${it.type}:${it.id}`}>
                  <span className="muted doc-small">{it.typeLabel}</span>{' '}
                  {it.ref && <span className="doc-number">{it.ref}</span>}{' '}
                  {it.route ? <Link to={it.type === 'policy' ? readerPath(it.id) : it.route}>{it.label}</Link> : it.label}
                </li>
              ))}
              {g.hidden > 0 && <li className="muted"><Icon name="lock" size={14} /> {g.hidden} more you cannot open</li>}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
