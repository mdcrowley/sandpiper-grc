// The relationship map started from a change (E05-08): the systems and assets one change
// affects, for the map to highlight (with their neighbors), and the banner that says so.
// The inventory module's map mounts it when the address carries `?change=<id>`:
//   const affected = useChangeAffected(params.get('change'));
//   <ChangeOnMapBanner affected={affected.data} onClear={...} />
//   highlight affected.data.systems / .assets (ids) and their neighbors.
import { Link } from 'react-router-dom';
import { Button, Icon, useAuth, useFetch } from '../../core';

export interface ChangeAffected {
  change: { id: string; ref: string; title: string; status: string; planned_start: string | null; planned_end: string | null };
  systems: { id: string; label: string; main: boolean }[];
  assets: { id: string; label: string; main: boolean }[];
}

/** The systems and assets a change affects, or nothing when there is no change id or no permission. */
export function useChangeAffected(changeId: string | null | undefined) {
  const { can } = useAuth();
  return useFetch<ChangeAffected>(changeId && can('changes.view') ? `/api/changes/${encodeURIComponent(changeId)}/affected` : null);
}

/** Every record id the map should highlight for a change. */
export const affectedIds = (a: ChangeAffected | null | undefined): string[] => (a ? [...a.systems, ...a.assets].map((x) => x.id) : []);

export function ChangeOnMapBanner({ affected, onClear }: { affected: ChangeAffected | null | undefined; onClear: () => void }) {
  if (!affected) return null;
  const names = [...affected.systems, ...affected.assets];
  return (
    <div className="notice chg-banner" role="note">
      <Icon name="calendar" />
      <div className="chg-banner-body">
        Highlighting what <Link to={`/changes/${affected.change.id}`}>{affected.change.ref} {affected.change.title}</Link> affects
        {names.length ? <>: {names.map((n) => n.label).join(', ')}, and their neighbors.</> : '. It names no system or asset yet.'}{' '}
        <Button size="sm" variant="ghost" onClick={onClear}>Show the whole map</Button>
      </div>
    </div>
  );
}
