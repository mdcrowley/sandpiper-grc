// The document library (E43-12): every published document the person may read, by tier of the
// hierarchy and by owning department, with a search over number, title and full text. Counts at the
// side are of what this person can open: it is a list, not a figure. Documents outside the person's
// distribution are not here at all, not even as a title.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, formatDate, Icon, Loading, PageHeader, StatusChip, Switch, TextField, cx, qs, useAuth, useDebounced, useFetch,
} from '../../../core';
import { DocumentsTabs } from './DocumentsTabs';
import { docNumber, readerPath, TIER_LABEL, TIER_ORDER, type LibraryResult, type LibraryRow, type LibraryTree } from './types';

interface TreeNode { value: string; label: string; count: number; tier?: string | number | null }

/** The parts of a text with the searched words marked, as text, never as HTML. */
export function markWords(text: string, query: string): { text: string; hit: boolean }[] {
  const words = query.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length > 1);
  if (!words.length) return [{ text, hit: false }];
  // Only letters, digits and hyphens are left, so nothing in a word is special in a pattern.
  const re = new RegExp(`(${words.join('|')})`, 'giu');
  return text.split(re).filter(Boolean).map((part) => ({ text: part, hit: words.some((w) => w.toLowerCase() === part.toLowerCase()) }));
}

/** A few words around the match, with the searched words marked. */
export function Excerpt({ text, query }: { text: string; query: string }) {
  return (
    <p className="doc-excerpt">
      {markWords(text, query).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

function FacetList({ title, nodes, active, onPick, allLabel }: {
  title: string; nodes: TreeNode[]; active: string; onPick: (value: string) => void; allLabel: string;
}) {
  return (
    <nav className="doc-facet" aria-label={title}>
      <h2 className="doc-facet-title">{title}</h2>
      <ul>
        <li>
          <button type="button" className={cx('doc-facet-item', !active && 'is-active')} aria-current={!active ? 'true' : undefined} onClick={() => onPick('')}>
            <span>{allLabel}</span>
          </button>
        </li>
        {nodes.map((n) => (
          <li key={n.value}>
            <button
              type="button" className={cx('doc-facet-item', active === n.value && 'is-active')} aria-current={active === n.value ? 'true' : undefined}
              onClick={() => onPick(active === n.value ? '' : n.value)}
            >
              <span>{n.label}</span><span className="doc-facet-count">{n.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Types grouped under their tier headings (policies and plans first, reference last). */
function TypeFacets({ types, active, onPick }: { types: TreeNode[]; active: string; onPick: (value: string) => void }) {
  const tiers = TIER_ORDER.map((t) => ({ tier: t, nodes: types.filter((n) => String(n.tier ?? '') === t) })).filter((g) => g.nodes.length);
  const loose = types.filter((n) => !TIER_ORDER.includes(String(n.tier ?? '')));
  return (
    <nav className="doc-facet" aria-label="Document types">
      <h2 className="doc-facet-title">Types</h2>
      <ul>
        <li>
          <button type="button" className={cx('doc-facet-item', !active && 'is-active')} aria-current={!active ? 'true' : undefined} onClick={() => onPick('')}>
            <span>All types</span>
          </button>
        </li>
      </ul>
      {[...tiers, ...(loose.length ? [{ tier: '', nodes: loose }] : [])].map((g) => (
        <div key={g.tier || 'other'} className="doc-tier">
          <h3 className="doc-tier-title">{TIER_LABEL[g.tier] ?? 'Other'}</h3>
          <ul>
            {g.nodes.map((n) => (
              <li key={n.value}>
                <button
                  type="button" className={cx('doc-facet-item', active === n.value && 'is-active')} aria-current={active === n.value ? 'true' : undefined}
                  onClick={() => onPick(active === n.value ? '' : n.value)}
                >
                  <span>{n.label}</span><span className="doc-facet-count">{n.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function LibraryItem({ row, query }: { row: LibraryRow; query: string }) {
  const obsolete = row.status === 'retired' || Boolean(row.retired_on);
  return (
    <li className="doc-item">
      <div className="doc-item-main">
        <p className="doc-item-head">
          {docNumber(row) && <span className="doc-number">{docNumber(row)}</span>}
          <Link className="doc-item-title" to={readerPath(row.id)}>{row.title}</Link>
          {(row.restricted || row.access === 'restricted') && (
            <span className="doc-lock" title="Restricted distribution: only the people it is distributed to can read it">
              <Icon name="lock" size={14} label="Restricted distribution" />
            </span>
          )}
          {obsolete && <StatusChip color="purple" label="Obsolete" size="sm" />}
        </p>
        {row.excerpt ? <Excerpt text={row.excerpt} query={query} /> : row.summary ? <p className="doc-excerpt muted">{row.summary}</p> : null}
      </div>
      <dl className="doc-item-meta">
        <div><dt>Type</dt><dd>{row.type_label ?? row.document_type ?? '—'}</dd></div>
        {row.department_name && <div><dt>Department</dt><dd>{row.department_name}</dd></div>}
        <div><dt>Version</dt><dd>{row.version_label || (row.version ? String(row.version) : '—')}</dd></div>
        <div><dt>Effective</dt><dd>{row.effective_on ? formatDate(row.effective_on) : '—'}</dd></div>
      </dl>
    </li>
  );
}

export function Library() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? '';
  const department = params.get('department') ?? '';
  const obsolete = params.get('obsolete') === '1';
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text.trim(), 300);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  useEffect(() => { if ((params.get('q') ?? '') !== q) set('q', q); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useFetch<LibraryTree>(`/api/documents/library/tree${qs({ include_obsolete: obsolete ? 1 : undefined })}`);
  const list = useFetch<LibraryResult>(
    `/api/documents/library${qs({ q, type, department, include_obsolete: obsolete ? 1 : undefined })}`,
    { keepPrevious: true },
  );

  let body: ReactNode;
  if (list.error) body = <ErrorState error={list.error} onRetry={list.reload} />;
  else if (!list.data) body = <Loading lines={8} label="Loading the library" />;
  else if (!list.data.rows.length) {
    const filtered = Boolean(q || type || department);
    body = (
      <EmptyState
        icon="file-text" title={filtered ? 'No documents match' : 'No documents to read yet'}
        message={filtered
          ? 'Try other words, or clear the type and department choices.'
          : 'Published documents that are distributed to you appear here.'}
      />
    );
  } else {
    body = (
      <>
        <p className="doc-count muted" aria-live="polite">
          {list.data.total === 1 ? '1 document' : `${list.data.total} documents`}
          {list.data.rows.length < list.data.total ? `, the first ${list.data.rows.length} shown. Narrow the search to see the rest.` : ''}
        </p>
        <ul className="doc-list">{list.data.rows.map((r) => <LibraryItem key={r.id} row={r} query={q} />)}</ul>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Document library"
        subtitle="Policies, plans, procedures and the other controlled documents in force, as far as they are distributed to you."
        actions={can('policies.create') ? <Link className="btn btn-primary" to="/documents/register?new=1">New document</Link> : undefined}
      />
      <DocumentsTabs active="library" />
      <div className="doc-library">
        <aside className="doc-side" aria-label="Browse the library">
          {tree.error ? <ErrorState error={tree.error} onRetry={tree.reload} />
            : !tree.data ? <Loading lines={6} label="Loading types and departments" />
            : (
              <>
                <TypeFacets types={tree.data.types} active={type} onPick={(v) => set('type', v)} />
                {tree.data.departments.some((d) => d.id && d.name) && (
                  <FacetList title="Departments" allLabel="All departments" nodes={tree.data.departments.filter((d) => d.id && d.name).map((d) => ({ value: d.id, label: d.name, count: d.count }))} active={department} onPick={(v) => set('department', v)} />
                )}
              </>
            )}
        </aside>
        <Card className="doc-main">
          <div className="doc-search">
            <TextField label="Search documents" value={text} onChange={setText} placeholder="Number, title or words in the text" />
            <Switch label="Show obsolete documents" checked={obsolete} onChange={(v) => set('obsolete', v ? '1' : '')} />
          </div>
          {body}
        </Card>
      </div>
    </div>
  );
}
