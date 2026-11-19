import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, EmptyState, errorMessage, ErrorState, IconButton, Loading, RecordPicker, Select, useAuth, useFetch, useMeta, useToast,
  type Row,
} from '../../core';

interface LinkRow {
  id: string;
  relation: string;
  direction: 'in' | 'out';
  type: string;
  typeLabel: string;
  recordId: string;
  label: string;
  ref: string | null;
  route: string;
}

const AFFECTS = 'affects';
const AFFECTED_TYPES = ['system', 'asset'];
const WORK_TYPES = ['ticket', 'problem', 'project'];
const RELATIONS: Record<string, { value: string; label: string }[]> = {
  ticket: [{ value: 'caused', label: 'This change caused it' }, { value: 'fixes', label: 'This change fixes it' }, { value: 'related', label: 'Related' }],
  problem: [{ value: 'fixes', label: 'This change fixes it' }, { value: 'caused', label: 'This change caused it' }, { value: 'related', label: 'Related' }],
  project: [{ value: 'delivers', label: 'This change is part of it' }, { value: 'related', label: 'Related' }],
};
const PHRASE: Record<string, string> = { caused: 'Caused by this change', fixes: 'Fixed by this change', delivers: 'This change is part of it', related: 'Related' };

interface AddProps { changeId: string; types: string[]; affects: boolean; onAdded: () => void }

function AddLink({ changeId, types, affects, onAdded }: AddProps) {
  const toast = useToast();
  const { resources } = useMeta();
  const [type, setType] = useState(types[0] ?? '');
  const [target, setTarget] = useState<string | null>(null);
  const [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false);
  if (!types.length) return null;
  const relations = RELATIONS[type] ?? [];
  const chosen = affects ? AFFECTS : relation || relations[0]?.value || 'related';

  async function add() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post('/api/links', { from_type: 'change', from_id: changeId, to_type: type, to_id: target, relation: chosen });
      setTarget(null);
      onAdded();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={affects ? 'chg-addlink chg-addlink-affects' : 'chg-addlink'}>
      <Select label="Type" value={type} onChange={(v) => { setType(v || types[0]); setTarget(null); setRelation(''); }} options={types.map((t) => ({ value: t, label: resources[t]?.label ?? t }))} />
      <RecordPicker key={type} label={resources[type]?.label ?? 'Record'} type={type} value={target} onChange={(id) => setTarget(id)} placeholder="Search…" />
      {!affects && <Select label="How it relates" value={chosen} onChange={setRelation} options={relations} />}
      <Button icon="plus" loading={busy} disabled={!target} onClick={() => void add()}>Add</Button>
    </div>
  );
}

function LinkTable({ rows, mainIds, canEdit, onRemove, phrase }: { rows: LinkRow[]; mainIds: string[]; canEdit: boolean; onRemove: (l: LinkRow) => void; phrase: boolean }) {
  return (
    <div className="table-wrap chg-tw">
      <table className="table">
        <thead><tr><th>Type</th><th>Record</th>{phrase && <th>How it relates</th>}<th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td>{l.typeLabel}</td>
              <td>
                <span className="row">
                  <Link to={`${l.route}/${l.recordId}`}>{[l.ref, l.label].filter(Boolean).join(' ')}</Link>
                  {mainIds.includes(l.recordId) && <Badge color="blue">Main</Badge>}
                </span>
              </td>
              {phrase && <td>{l.direction === 'out' ? PHRASE[l.relation] ?? l.relation : `Linked from the ${l.typeLabel.toLowerCase()} (${l.relation})`}</td>}
              <td className="num">
                {canEdit && l.direction === 'out' && !mainIds.includes(l.recordId) && (
                  <IconButton icon="trash" variant="ghost" label={`Remove the link to ${l.label}`} onClick={() => onRemove(l)} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What a change touches (systems and assets) and the work it relates to (tickets, problems, projects). */
export function RelatedTab({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const { resources } = useMeta();
  const { can } = useAuth();
  const { data, error, reload: reloadLinks } = useFetch<LinkRow[]>(`/api/links?record_type=change&record_id=${row.id}`);
  // The systems a change affects decide its conflicts, so those are checked again too.
  const reload = () => { reloadLinks(); onChanged(); };
  if (error) return <ErrorState title="The links could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading links" />;

  const affected = data.filter((l) => l.direction === 'out' && l.relation === AFFECTS && AFFECTED_TYPES.includes(l.type));
  const work = data.filter((l) => WORK_TYPES.includes(l.type));
  const affectedTypes = AFFECTED_TYPES.filter((t) => resources[t]);
  const workTypes = WORK_TYPES.filter((t) => resources[t]);
  const editable = canEdit && !['closed', 'cancelled'].includes(row.status);

  async function remove(l: LinkRow) {
    try {
      await api.del(`/api/links/${l.id}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="stack">
      <Card title="Affected systems and assets" flush
        actions={resources.system && can('systems.view') && (affected.length > 0 || row.system_id || row.asset_id) ? (
          <Link className="btn btn-secondary btn-sm" to={`/systems/map?change=${encodeURIComponent(row.id)}`}>Show on relationship map</Link>
        ) : undefined}>
        {affectedTypes.length === 0 ? (
          <EmptyState icon="server" title="The inventory is not available" message="Systems and assets can be linked when the inventory is switched on." />
        ) : (
          <>
            {affected.length === 0
              ? <EmptyState icon="server" title="Nothing recorded yet" message="Add every system and asset this change touches. Two changes that overlap on the same system are flagged as a conflict." />
              : <LinkTable rows={affected} mainIds={[row.system_id, row.asset_id].filter(Boolean)} canEdit={editable} onRemove={(l) => void remove(l)} phrase={false} />}
            {editable && <div className="chg-card-foot"><AddLink changeId={row.id} types={affectedTypes} affects onAdded={reload} /></div>}
          </>
        )}
      </Card>

      <Card title="Tickets, problems and projects" flush>
        {workTypes.length === 0 ? (
          <EmptyState icon="link" title="Nothing to link to" message="Tickets, problems and projects can be linked when those areas are switched on." />
        ) : (
          <>
            {work.length === 0
              ? <EmptyState icon="link" title="No related work" message="Link the ticket or problem this change fixes or caused, and the project it belongs to. The link shows on both records." />
              : <LinkTable rows={work} mainIds={[]} canEdit={editable} onRemove={(l) => void remove(l)} phrase />}
            {editable && <div className="chg-card-foot"><AddLink changeId={row.id} types={workTypes} affects={false} onAdded={reload} /></div>}
          </>
        )}
      </Card>
    </div>
  );
}
