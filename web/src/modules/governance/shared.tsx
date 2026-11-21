// Shared pieces of the committee pages: section tabs, a link to a record named by the server, and the
// action panel loader.
import { lazy, Suspense, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Loading, Tabs } from '../../core';

const SECTIONS = [
  { key: 'committees', label: 'Committees', path: '/governance/committees' },
  { key: 'meetings', label: 'Meetings', path: '/governance/meetings' },
  { key: 'decisions', label: 'Decisions', path: '/governance/decisions' },
] as const;

export function GovernanceTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Committee sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/governance/committees')} />
  );
}

/** A record as the server names it: `{ hidden: true }` when the reader may not see it. */
export interface NamedRecord { type?: string; typeLabel?: string; id?: string; label?: string; ref?: string | null; route?: string; hidden?: boolean }

export function RecordName({ record }: { record: NamedRecord | null | undefined }) {
  if (!record) return <span className="muted">None</span>;
  if (record.hidden) return <span className="muted">A record you cannot see</span>;
  return (
    <Link to={`${record.route}/${record.id}`}>
      <span className="muted">{record.typeLabel}</span> {record.label}
    </Link>
  );
}

export interface Member {
  id: string; user_id: string | null; person_id: string | null; name: string; side: string | null; role: string; voting: boolean;
  from_on: string | null; to_on: string | null; current: boolean; user_name: string | null;
}

// The action tracker lives in the risks module; load its panel only when that module is in the build.
const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>('../risks/ActionsPanel.tsx');
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

export function MeetingActions({ meetingId }: { meetingId: string }) {
  if (!LazyActions) return <Card title="Actions"><p className="muted">The action tracker is not part of this installation.</p></Card>;
  return <Suspense fallback={<Loading lines={3} />}><LazyActions sourceType="meeting" sourceId={meetingId} source="meeting" /></Suspense>;
}
