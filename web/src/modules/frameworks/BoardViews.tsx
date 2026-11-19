// Saved views of the outcomes board (E07-25). A person's own views are a preference kept on the
// server (`views:framework_board`, mirrored in this browser, so views saved here before carry
// over); a view can also be shared with everyone who can see the outcomes, through the shared
// list views of core (`/api/views`, record type framework_outcome). A shared board view is
// stored as list filters on the outcome fields, so it opens on the table view too.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError, Button, ConfirmDialog, IconButton, Menu, Modal, StatusChip, Switch, TextField, api, errorMessage, useFetch,
  useSyncedPreference, useToast,
} from '../../core';
import type { MenuItem } from '../../core';
import { boardQueryOf, filtersFromQuery, listViewOf, queryFromFilters } from './boardState';
import type { BoardFilters, BoardView, ListView } from './boardState';

const TYPE = 'framework_outcome';

interface SharedView {
  id: string;
  name: string;
  view: ListView;
  createdBy: { id: string; label: string } | null;
  mine: boolean;
  canManage: boolean;
}

export function ViewsMenu({ filters, onApply }: { filters: BoardFilters; onApply: (query: string) => void }) {
  const toast = useToast();
  const [mine, setMine] = useSyncedPreference<BoardView[]>('views:framework_board', 'grc.views.framework_board', []);
  const shared = useFetch<{ views: SharedView[] }>(`/api/views?record_type=${TYPE}`);
  const [naming, setNaming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ kind: 'mine'; view: BoardView } | { kind: 'shared'; view: SharedView } | null>(null);
  const own = Array.isArray(mine) ? mine.filter((v) => v && typeof v.name === 'string' && typeof v.query === 'string') : [];
  const sharedViews = (shared.data?.views ?? []).map((v) => ({ ...v, query: boardQueryOf(v.view) }));
  const current = queryFromFilters(filters);
  const activeMine = own.find((v) => v.query === current);
  const activeShared = sharedViews.find((v) => v.query === current);
  const activeName = activeMine?.name ?? activeShared?.name;

  async function save(e: FormEvent) {
    e.preventDefault();
    const label = name.trim();
    if (!label) { setError('Give the view a name.'); return; }
    if (label.length > 60) { setError('Keep the name to 60 characters or fewer.'); return; }
    setBusy(true);
    try {
      if (share) {
        await api.post('/api/views', { record_type: TYPE, name: label, view: listViewOf(filtersFromQuery(current)) });
        shared.reload();
        toast.success(`View "${label}" shared with everyone who can see the outcomes.`);
      } else {
        setMine([...own.filter((v) => v.name.toLowerCase() !== label.toLowerCase()), { name: label, query: current }].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`View "${label}" saved. It follows you to any browser.`);
      }
      setNaming(false);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.name ? err.fields.name : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function shareOwn(v: BoardView) {
    setBusy(true);
    try {
      await api.post('/api/views', { record_type: TYPE, name: v.name, view: listViewOf(filtersFromQuery(v.query)) });
      setMine(own.filter((x) => x !== v));
      shared.reload();
      toast.success(`"${v.name}" is now shared with everyone who can see the outcomes.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    if (removing.kind === 'mine') {
      setMine(own.filter((v) => v !== removing.view));
      setRemoving(null);
      return;
    }
    setBusy(true);
    try {
      await api.del(`/api/views/${removing.view.id}`);
      toast.success(`Shared view "${removing.view.name}" removed.`);
      shared.reload();
      setRemoving(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const items: MenuItem[] = [
    { label: 'All outcomes', icon: current === '' ? 'check' : undefined, onSelect: () => onApply('') },
    { label: 'Priority outcomes', icon: current === 'priority=1' ? 'check' : 'star', onSelect: () => onApply('priority=1') },
    ...own.map((v, i) => ({ label: v.name, icon: v.query === current ? 'check' as const : undefined, separated: i === 0, onSelect: () => onApply(v.query) })),
    ...sharedViews.map((v, i) => ({
      label: `${v.name} (shared${v.mine ? '' : ` by ${v.createdBy?.label ?? 'someone'}`})`,
      icon: v.query === current ? 'check' as const : 'users' as const, separated: i === 0, onSelect: () => onApply(v.query),
    })),
    { label: 'Save current view…', icon: 'plus', separated: true, disabled: current === '', onSelect: () => { setError(''); setShare(false); setName(activeMine?.name ?? ''); setNaming(true); } },
    { label: 'Manage views…', icon: 'settings', disabled: own.length + sharedViews.length === 0, onSelect: () => setManaging(true) },
  ];

  return (
    <>
      <Menu label={activeName ?? 'Views'} icon="eye" size="sm" items={items} align="end" />
      <Modal open={naming} title="Save current view" size="sm" onClose={() => setNaming(false)}>
        <form className="form" onSubmit={save} noValidate>
          <TextField label="Name" required autoFocus value={name} onChange={setName} error={error}
            hint={share ? 'A shared view needs a name no other shared view of the outcomes uses.' : 'Your views follow you to any browser. A view of yours with the same name is replaced.'} />
          <Switch label="Share with everyone who can see the outcomes" checked={share} onChange={setShare}
            hint="Shared views show in everyone’s Views menu with your name, here and in the table view." />
          <div className="form-actions">
            <Button onClick={() => setNaming(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>{share ? 'Share view' : 'Save view'}</Button>
          </div>
        </form>
      </Modal>
      <Modal open={managing} title="Saved views" size="md" onClose={() => setManaging(false)}>
        <div className="stack">
          {own.length > 0 && (
            <ul className="fw-views-list" aria-label="Your views">
              {own.map((v) => (
                <li key={v.name}>
                  <span className="fw-views-name">{v.name}</span>
                  <Button size="sm" variant="ghost" icon="users" loading={busy} onClick={() => void shareOwn(v)}>Share</Button>
                  <IconButton icon="trash" size="sm" variant="ghost" label={`Delete view ${v.name}`} onClick={() => setRemoving({ kind: 'mine', view: v })} />
                </li>
              ))}
            </ul>
          )}
          {sharedViews.length > 0 && (
            <ul className="fw-views-list" aria-label="Shared views">
              {sharedViews.map((v) => (
                <li key={v.id}>
                  <span className="fw-views-name">
                    {v.name}
                    <span className="fw-views-owner"> · {v.mine ? 'shared by you' : `shared by ${v.createdBy?.label ?? 'someone'}`}</span>
                  </span>
                  <StatusChip color="blue" label="Shared" size="sm" />
                  {v.canManage && <IconButton icon="trash" size="sm" variant="ghost" label={`Remove shared view ${v.name}`} onClick={() => setRemoving({ kind: 'shared', view: v })} />}
                </li>
              ))}
            </ul>
          )}
          <div className="form-actions"><Button onClick={() => setManaging(false)}>Close</Button></div>
        </div>
      </Modal>
      <ConfirmDialog
        open={removing !== null} title={removing?.kind === 'shared' ? 'Remove this shared view?' : 'Delete this view?'} danger busy={busy}
        confirmLabel={removing?.kind === 'shared' ? 'Remove view' : 'Delete view'}
        message={removing?.kind === 'shared'
          ? `"${removing.view.name}" will disappear from everyone's Views menu. The outcomes are not affected.`
          : `"${removing?.view.name ?? ''}" will be removed from your saved views. The outcomes are not affected.`}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
