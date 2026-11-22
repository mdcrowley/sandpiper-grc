import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, COLOR_NAMES, EmptyState, ErrorState, errorMessage, humanize, Icon, IconButton, Loading, Modal,
  PageHeader, Select, StatusChip, TableWrap, Tabs, TagChips, TextField, toColorName, useFetch, useMeta, useToast,
} from '../../core';
import type { ColorName, ResourceMeta } from '../../core';

interface ListSummary { list_key: string; count: number }
interface LookupRow { id: string; list_key: string; value: string; label: string; color: ColorName; sort: number; active: boolean }
interface Usage { type: string; typeLabel: string; fieldLabel: string; custom?: boolean }

/** A list made for a custom field is named after that field; the others after their key. */
const listTitle = (list: string, usage: Usage[] | undefined) => {
  const own = list.startsWith('cf_') ? usage?.find((u) => u.custom) : undefined;
  return own ? `${own.fieldLabel} (custom field)` : humanize(list);
};

const slug = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Which record fields offer each list, worked out from the record types this person can see. */
function usageByList(resources: Record<string, ResourceMeta> | undefined): Record<string, Usage[]> {
  const out: Record<string, Usage[]> = {};
  for (const r of Object.values(resources ?? {})) {
    for (const f of Object.values(r.fields)) {
      if (f.list) (out[f.list] ??= []).push({ type: r.type, typeLabel: r.label, fieldLabel: f.label, custom: f.custom });
    }
  }
  return out;
}

/** The eight colors as a row of swatches. Radio buttons underneath, so the arrow keys move between them. */
function ColorPicker({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <fieldset className="adm-fieldset">
      <legend className="field-label">Color</legend>
      <div className="adm-swatches">
        {COLOR_NAMES.map((c) => (
          <label key={c} className="adm-swatch">
            <input type="radio" name="adm-color" value={c} checked={c === value} onChange={() => onChange(c)} />
            <span className="adm-swatch-dot" style={{ background: `var(--c-${c}-solid)` }} aria-hidden="true">
              {c === value && <Icon name="check" size={14} />}
            </span>
            <span className="adm-swatch-name">{humanize(c)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ListsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'tags' ? 'tags' : 'lists';
  return (
    <>
      <PageHeader
        title="Lists"
        subtitle="The choices offered in drop-downs across the application (statuses, priorities, categories and so on), and the free-form tags people put on records. Changes apply at once, with no code."
      />
      <Tabs
        label="Lists and tags"
        active={tab}
        onChange={(key) => setParams(key === 'tags' ? { tab: 'tags' } : {}, { replace: true })}
        tabs={[
          { key: 'lists', label: 'Lists', content: <ListsTab /> },
          { key: 'tags', label: 'Tags', content: <TagsTab /> },
        ]}
      />
    </>
  );
}

function ListsTab() {
  const lists = useFetch<ListSummary[]>('/api/lookups');
  const { resources } = useMeta();
  const usage = useMemo(() => usageByList(resources), [resources]);
  const [params, setParams] = useSearchParams();
  const [find, setFind] = useState('');
  const selected = params.get('list') ?? lists.data?.[0]?.list_key ?? '';
  const needle = find.trim().toLowerCase();
  const shown = (lists.data ?? []).filter((l) =>
    !needle || l.list_key.includes(needle) || listTitle(l.list_key, usage[l.list_key]).toLowerCase().includes(needle)
    || (usage[l.list_key] ?? []).some((u) => u.typeLabel.toLowerCase().includes(needle)));

  return (
    <div className="adm-tab-body">
      {lists.error ? <ErrorState error={lists.error} onRetry={lists.reload} />
        : !lists.data ? <Loading lines={8} label="Loading lists" />
        : lists.data.length === 0 ? <EmptyState icon="clipboard" title="No lists yet" message="Lists appear here once a module that uses them is installed." />
        : (
          <div className="adm-lists">
            <Card title={`Lists (${lists.data.length})`} flush>
              <div className="adm-list-find">
                <TextField label="Find a list" hideLabel type="search" placeholder="Find a list or record type" leftSection={<Icon name="search" size={16} />} value={find} onChange={setFind} />
              </div>
              {shown.length === 0 ? <p className="card-body muted" role="status">No list matches “{find.trim()}”.</p> : (
                <nav className="adm-list-nav" aria-label="Lists">
                  {shown.map((l) => (
                    <button key={l.list_key} type="button" aria-current={l.list_key === selected ? 'true' : undefined} onClick={() => setParams({ list: l.list_key })}>
                      <span className="adm-list-nav-text">
                        <span>{listTitle(l.list_key, usage[l.list_key])}</span>
                        {usage[l.list_key]?.length ? <span className="adm-list-nav-hint">{[...new Set(usage[l.list_key].map((u) => u.typeLabel))].join(', ')}</span> : null}
                      </span>
                      <span className="adm-count">{l.count}</span>
                    </button>
                  ))}
                </nav>
              )}
            </Card>
            {selected && <ListValues key={selected} list={selected} usage={usage[selected] ?? []} onChanged={lists.reload} />}
          </div>
        )}
    </div>
  );
}

/* ---------- tags (server: core/tags.ts) ---------- */

interface TagUse { tag: string; count: number }

/** The tags in use on one record type, with how many records carry each, and renaming or merging them. */
function TagsTab() {
  const { resources } = useMeta();
  const [params, setParams] = useSearchParams();
  const types = useMemo(() => Object.values(resources ?? {}).sort((a, b) => a.label.localeCompare(b.label)), [resources]);
  const wanted = params.get('type') ?? '';
  const type = wanted && resources?.[wanted] ? wanted : types[0]?.type ?? '';
  const resource = resources?.[type];
  const { data, error, reload, loading } = useFetch<TagUse[]>(type ? `/api/tags/options?record_type=${encodeURIComponent(type)}` : null, { keepPrevious: true });
  const [find, setFind] = useState('');
  const [renaming, setRenaming] = useState<TagUse | null>(null);
  const needle = find.trim().toLowerCase();
  const shown = (data ?? []).filter((t) => !needle || t.tag.includes(needle));
  const noun = (n: number) => (n === 1 ? resource?.label ?? 'record' : resource?.plural ?? 'records').toLowerCase();

  return (
    <div className="adm-tab-body">
      <p className="muted adm-tags-intro">
        Anyone who can change a record can tag it. Rename a tag here to correct it on every record of a type at once; renaming it to a tag
        that already exists merges the two. Each change is recorded in the audit log.
      </p>
      <div className="adm-toolbar adm-toolbar-top">
        <Select
          className="adm-toolbar-grow" label="Record type" searchable value={type}
          options={types.map((t) => ({ value: t.type, label: t.label }))}
          onChange={(v) => setParams(v ? { tab: 'tags', type: v } : { tab: 'tags' }, { replace: true })}
        />
        <TextField label="Find a tag" type="search" placeholder="Part of a tag" leftSection={<Icon name="search" size={16} />} value={find} onChange={setFind} />
      </div>
      <Card flush title={resource ? `Tags on ${resource.plural.toLowerCase()}${data ? ` (${data.length})` : ''}` : 'Tags'}>
        {!type ? <EmptyState icon="tag" title="No record types" message="Tags appear once a module with records is installed." />
          : error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={5} label="Loading tags" /></div>
          : data.length === 0 ? (
            <EmptyState icon="tag" title={`No ${resource?.plural.toLowerCase() ?? 'records'} are tagged yet`}
              message="Tags are added on a record’s page, under its title. They are listed here with how many records carry each one." />
          ) : shown.length === 0 ? <p className="card-body muted" role="status">No tag matches “{find.trim()}”.</p> : (
            <TableWrap label={resource ? `Tags on ${resource.plural.toLowerCase()}${data ? ` (${data.length})` : ''}` : 'Tags'} className={`adm-table-frame${loading ? ' table-loading' : ''}`} aria-busy={loading}>
              <table className="table adm-tags">
                <thead>
                  <tr><th scope="col">Tag</th><th scope="col" className="num">Records</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.tag}>
                      <td><TagChips tags={[t.tag]} /></td>
                      <td className="num">
                        {resource
                          ? <Link to={`${resource.route}?f.tags=${encodeURIComponent(t.tag)}`} aria-label={`${t.count} ${noun(t.count)} tagged ${t.tag}`}>{t.count}</Link>
                          : t.count}
                      </td>
                      <td className="adm-row-actions">
                        <Button size="sm" variant="ghost" icon="edit" aria-label={`Rename or merge ${t.tag}`} onClick={() => setRenaming(t)}>Rename</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        {data && data.length >= 200 && <p className="card-body adm-card-foot muted">The 200 most used tags are shown. Find a tag to narrow the list.</p>}
      </Card>
      {renaming && resource && (
        <RenameTagDialog
          tag={renaming} recordType={resource.type} noun={noun} existing={data ?? []}
          onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); reload(); }}
        />
      )}
    </div>
  );
}

/** Tags as stored: lower case, single spaces, no commas, at most 40 characters (core/resource.ts normalizeTag). */
const normalizeTag = (raw: string) => raw.toLowerCase().replace(/[\s,]+/g, ' ').trim().slice(0, 40);

function RenameTagDialog({ tag, recordType, noun, existing, onClose, onDone }: {
  tag: TagUse; recordType: string; noun: (n: number) => string; existing: TagUse[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState(tag.tag);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = normalizeTag(to);
  const target = existing.find((t) => t.tag === clean && t.tag !== tag.tag);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean) { setError('Type the new name.'); return; }
    if (clean === tag.tag) { onClose(); return; }
    setBusy(true);
    try {
      await api.post('/api/admin/tags/rename', { record_type: recordType, from: tag.tag, to: clean });
      toast.success(target ? `“${tag.tag}” merged into “${clean}”.` : `“${tag.tag}” renamed to “${clean}”.`);
      onDone();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setError(fields.to ?? fields.from ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Rename “${tag.tag}”`} size="sm" onClose={onClose} dirty={to !== tag.tag}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField
          label="New name" required autoFocus maxLength={40} value={to} onChange={(v) => { setTo(v); setError(''); }} error={error || undefined}
          hint={target
            ? `“${clean}” is already on ${target.count} ${noun(target.count)}: the two tags will be merged into one.`
            : `Changes the tag on ${tag.count} ${noun(tag.count)}. Tags are kept in lower case.`}
        />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{target ? 'Merge tags' : 'Rename tag'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ListValues({ list, usage, onChanged }: { list: string; usage: Usage[]; onChanged: () => void }) {
  const toast = useToast();
  const meta = useMeta();
  const { data, error, reload } = useFetch<LookupRow[]>(`/api/lookups/${encodeURIComponent(list)}`);
  const [editing, setEditing] = useState<LookupRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  // The order on screen while a move is being saved, so the row jumps at once.
  const [moved, setMoved] = useState<LookupRow[] | null>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => { setMoved(null); }, [data]);
  const rows = moved ?? data;

  const changed = () => { reload(); onChanged(); void meta.reload(); };
  const attempt = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      setMoved(null);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      changed();
    }
  };

  /** Moves one value and renumbers the list in steps of ten; only the values whose number changed are saved. */
  const move = (index: number, by: -1 | 1) => {
    if (!rows) return;
    const order = [...rows];
    const [row] = order.splice(index, 1);
    order.splice(index + by, 0, row);
    const renumbered = order.map((r, i) => ({ ...r, sort: (i + 1) * 10 }));
    const before = new Map(rows.map((r) => [r.id, r.sort]));
    setMoved(renumbered);
    setAnnounce(`${row.label} moved ${by < 0 ? 'up' : 'down'}, now ${index + by + 1} of ${order.length}.`);
    void attempt(async () => {
      for (const r of renumbered) if (before.get(r.id) !== r.sort) await api.patch(`/api/lookups/${r.id}`, { sort: r.sort });
    }, 'Order saved.');
  };

  return (
    <Card
      title={listTitle(list, usage)} flush
      actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Add value</Button>}
    >
      <div className="card-body adm-usage">
        <Icon name="link" size={16} />
        {usage.length === 0 ? (
          <span className="muted">No record field offers this list directly. It may be used by a page of its own.</span>
        ) : (
          <span>
            <span className="muted">Used by </span>
            {usage.map((u, i) => (
              <span key={`${u.type}.${u.fieldLabel}`}>{i > 0 && ', '}<strong>{u.typeLabel}</strong> <span className="muted">({u.fieldLabel})</span></span>
            ))}
          </span>
        )}
        <code className="adm-usage-key">{list}</code>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !rows ? <div className="card-body"><Loading lines={5} label="Loading values" /></div>
        : rows.length === 0 ? <EmptyState icon="clipboard" title="This list has no values" message="Add the first value." action={<Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add value</Button>} />
        : (
          <TableWrap label={listTitle(list, usage)} className="adm-table-frame" aria-busy={busy}>
            <table className="table adm-values">
              <thead><tr><th scope="col">Order</th><th scope="col">Shown as</th><th scope="col">Stored value</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={r.active ? undefined : 'adm-retired'}>
                    <td>
                      <span className="adm-order">
                        <span className="adm-order-n">{i + 1}</span>
                        <IconButton size="sm" icon="arrow-up" label={`Move up: ${r.label}`} disabled={busy || i === 0} onClick={() => move(i, -1)} />
                        <IconButton size="sm" icon="arrow-down" label={`Move down: ${r.label}`} disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)} />
                      </span>
                    </td>
                    <td><StatusChip color={toColorName(r.color)} label={r.label} /></td>
                    <td><code>{r.value}</code></td>
                    <td>{r.active ? 'In use' : <span className="muted">Retired</span>}</td>
                    <td className="adm-row-actions">
                      <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${r.label}`} onClick={() => setEditing(r)}>Edit</Button>
                      {r.active
                        ? <Button size="sm" variant="ghost" aria-label={`Retire ${r.label}`} disabled={busy} onClick={() => void attempt(() => api.del(`/api/lookups/${r.id}`), `“${r.label}” retired.`)}>Retire</Button>
                        : <Button size="sm" variant="ghost" aria-label={`Restore ${r.label}`} disabled={busy} onClick={() => void attempt(() => api.patch(`/api/lookups/${r.id}`, { active: true }), `“${r.label}” restored.`)}>Restore</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      <p className="sr-only" role="status">{announce}</p>
      <p className="card-body adm-card-foot muted">
        Values are offered in this order. They are retired, never deleted, so existing records keep their meaning; a retired value can no longer be chosen.
      </p>
      <ValueDialog
        list={list} row={editing === 'new' ? null : editing} open={editing !== null}
        nextSort={((rows?.reduce((m, r) => Math.max(m, r.sort), 0) ?? 0)) + 10}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }}
      />
    </Card>
  );
}

function ValueDialog({ list, row, open, nextSort, onClose, onSaved }: {
  list: string; row: LookupRow | null; open: boolean; nextSort: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<ColorName>('gray');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLabel(row?.label ?? '');
    setColor(toColorName(row?.color));
    setErrors({});
    setFormError('');
  }, [open, row]);
  const value = row?.value ?? slug(label);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) { setErrors({ label: 'Enter the text people will see.' }); return; }
    if (!row && !value) { setErrors({ label: 'Use at least one letter or number.' }); return; }
    setBusy(true);
    setFormError('');
    try {
      if (row) await api.patch(`/api/lookups/${row.id}`, { label: label.trim(), color });
      else await api.post('/api/lookups', { list_key: list, value, label: label.trim(), color, sort: nextSort });
      toast.success(row ? 'Value saved.' : 'Value added.');
      onSaved();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors({ ...fields, label: fields.label ?? fields.value ?? '' });
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={row ? `Edit “${row.label}”` : `Add a value to ${humanize(list)}`} size="sm" onClose={onClose} dirty={open && (label !== (row?.label ?? '') || color !== toColorName(row?.color))}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField
          label="Shown as" required autoFocus maxLength={80} value={label} onChange={setLabel} error={errors.label || undefined}
          hint={value ? `Stored as “${value}”. The stored value never changes, so renaming is safe.` : 'The text people will see.'}
        />
        <ColorPicker value={color} onChange={setColor} />
        {errors.color && <p className="field-error" role="alert">{errors.color}</p>}
        <p className="adm-preview"><span className="muted">Preview</span> <StatusChip color={color} label={label.trim() || 'New value'} /></p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{row ? 'Save value' : 'Add value'}</Button>
        </div>
      </form>
    </Modal>
  );
}
