// The changes that affect one system or asset (E05-08), for the system and asset pages: planned
// and current changes first, then earlier ones, newest first, each with its status and window.
// Any module may embed it: `<RecordChangesPanel type="system" id={row.id} />`.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDateTime, Loading, StatusChip, useAuth, useFetch } from '../../core';
import type { ColorName } from '../../core';
import './changes.css';

interface AffectingChange {
  id: string;
  ref: string;
  title: string;
  main: boolean;
  status: string;
  status_label: string;
  status_color: string;
  change_type_label: string;
  owner_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  when: 'planned' | 'now' | 'earlier';
}

const GROUPS: { key: AffectingChange['when']; label: string }[] = [
  { key: 'now', label: 'Under way' },
  { key: 'planned', label: 'Planned' },
  { key: 'earlier', label: 'Earlier' },
];

export function RecordChangesPanel({ type, id, limit = 10 }: { type: 'system' | 'asset'; id: string; limit?: number }) {
  const { can } = useAuth();
  const allowed = can('changes.view');
  const { data, error, reload } = useFetch<{ total: number; open: number; rows: AffectingChange[] }>(
    allowed ? `/api/changes/affecting?type=${type}&id=${encodeURIComponent(id)}&limit=${limit}` : null);
  if (!allowed) return null;
  const what = type === 'system' ? 'system' : 'asset';

  return (
    <Card
      title={<>Changes{data && data.total > 0 && <span className="tab-count">{data.total}</span>}</>}
      flush
      actions={(
        <>
          {type === 'system' && <Link className="btn btn-ghost btn-sm" to={`/changes/calendar?system=${encodeURIComponent(id)}`}>Calendar</Link>}
          {can('changes.create') && <Link className="btn btn-secondary btn-sm" to="/changes/new">New change</Link>}
        </>
      )}
    >
      {error ? <ErrorState title="The changes could not be loaded" error={error} onRetry={reload} />
        : !data ? <div style={{ padding: 'var(--s-3)' }}><Loading lines={3} label="Loading changes" /></div>
        : data.rows.length === 0 ? (
          <EmptyState icon="calendar" title={`No changes affect this ${what}`}
            message={`A change shows here when this ${what} is its main ${what}, or when the change is linked to it as affected.`} />
        ) : (
          <>
            {GROUPS.map((g) => {
              const list = data.rows.filter((r) => r.when === g.key);
              if (!list.length) return null;
              return (
                <section key={g.key} aria-label={g.label}>
                  <h3 className="chg-rec-group">{g.label}</h3>
                  <ul className="chg-rec-list">
                    {list.map((c) => (
                      <li key={c.id}>
                        <Link className="chg-rec-title" to={`/changes/${c.id}`}>{c.ref} {c.title}</Link>
                        <StatusChip color={c.status_color as ColorName} label={c.status_label} size="sm" />
                        <span className="chg-rec-meta">
                          <span>{c.change_type_label}</span>
                          <span>{c.planned_start ? `${formatDateTime(c.planned_start)} to ${c.planned_end ? formatDateTime(c.planned_end) : 'not set'}` : 'No planned window yet'}</span>
                          {!c.main && <span>Linked as affected</span>}
                          {c.owner_name && <span>Owner: {c.owner_name}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {data.total > data.rows.length && (
              <p className="muted" style={{ margin: 0, padding: 'var(--s-2) var(--s-3)' }}>
                Showing the {data.rows.length} most recent of {data.total}.{' '}
                {type === 'system' ? <Link to={`/changes?f.system_id=${encodeURIComponent(id)}`}>Changes with this as the main system</Link> : <Link to={`/changes?f.asset_id=${encodeURIComponent(id)}`}>Changes with this as the main asset</Link>}
              </p>
            )}
          </>
        )}
    </Card>
  );
}
