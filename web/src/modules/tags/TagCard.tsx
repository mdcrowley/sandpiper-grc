// The tag card as a page (E37-04, E37-05, E37-06): /asset-tags/find?value=<text>[&source=handheld].
// Owner: TAGS-LOOKUP. What a tag number (typed, or from a handheld scanner) is stuck to, and the actions
// the server lists for this person. The page never decides what is allowed: it draws the server's list.
// Laid out for a phone from 390 px wide up, since people use it standing next to the equipment.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Icon, KeyValue, Loading,
  LookupSelect, Modal, PageHeader, qs, RecordPicker, relativeTime, ResourceForm, Select, StatusChip, TextArea, TextField, useFetch,
  UserPicker, useResource, useToast, type Row,
} from '../../core';
import type { CardActivityItem, LookupResponse, LookupResult, QuickField, TagAction, TagCard } from './api';
import { findPath, TagFindForm, TagValue, type FindSource } from './FindByTag';
import './lookup.css';

/** A prefilled new record, with the record to link it to (an addition to the shared TagAction, see server actions.ts). */
type Prefill = NonNullable<TagAction['prefill']> & { link?: { type: string; id: string } | null };

/** The fields each kind of new record shows when started from a tag card; everything else stays as prefilled. */
const FORM_FIELDS: Record<string, string[]> = {
  ticket: ['title', 'description', 'urgency', 'impact', 'asset_id', 'system_id'],
  safety_event: ['title', 'description', 'event_type', 'severity', 'occurred_at', 'site_id', 'vehicle_id', 'location_detail'],
  condition_assessment: ['assessed_on', 'rating', 'method', 'notes'],
  inspection: ['template_id', 'due_on', 'inspector_id'],
};
/** New records that may carry photos taken on the spot. */
const WITH_PHOTOS = new Set(['ticket', 'safety_event']);

/** Sends one file to a record as an attachment (raw body, as the attachments module expects). */
async function sendFile(recordType: string, recordId: string, file: File, description?: string): Promise<{ id: string }> {
  const res = await fetch(`/api/attachments/upload${qs({ record_type: recordType, record_id: recordId, name: file.name, kind: 'file', description })}`, {
    method: 'PUT', body: file, credentials: 'same-origin',
    headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
  });
  let body: { id?: string; error?: { code?: string; message?: string } } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? `"${file.name}" could not be sent.`);
  return { id: body.id! };
}

/** PATCH with If-Match: the version the person saw (spec §5.4, the normal update path). */
async function patchIfMatch(path: string, version: string, body: Record<string, unknown>): Promise<Row> {
  const res = await fetch(path, {
    method: 'PATCH', credentials: 'same-origin', body: JSON.stringify(body),
    headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/json', Accept: 'application/json', 'If-Match': version },
  });
  let out: Row & { error?: { code?: string; message?: string; fields?: Record<string, string> } } = { id: '' };
  try { out = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, out.error?.code ?? `http_${res.status}`, out.error?.message ?? `The change was not saved (${res.status}).`, out.error?.fields ?? {});
  return out;
}

/** A photo file picker with a large target, the camera on a phone. */
function PhotoPicker({ files, onChange, label = 'Add photos' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  return (
    <div className="tag-photos">
      <label className="btn btn-secondary tag-photo-btn">
        <Icon name="upload" size={18} />
        <span>{label}</span>
        <input type="file" accept="image/*" capture="environment" multiple className="sr-only"
          onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>
      {files.length > 0 && (
        <ul className="tag-photo-list" aria-label="Chosen photos">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="truncate">{f.name}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- dialogs for the actions ----------

function NewRecordDialog({ card, action, onClose }: { card: TagCard; action: TagAction; onClose: () => void }) {
  const prefill = action.prefill as Prefill;
  const resource = useResource(prefill.type);
  const navigate = useNavigate();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const fields = (FORM_FIELDS[prefill.type] ?? Object.keys(prefill.values))
    .filter((f) => !resource || f in resource.fields)
    // The affected record fields show only when this report fills them.
    .filter((f) => !['asset_id', 'system_id', 'vehicle_id'].includes(f) || f in prefill.values);
  const display: Record<string, string> = {};
  for (const [f, v] of Object.entries(prefill.values)) {
    if (v === card.recordId) display[f] = [card.ref, card.title].filter(Boolean).join(' ');
    else if (card.site && v === card.site.id) display[f] = [card.site.ref, card.site.label].filter(Boolean).join(' ');
  }
  const saved = async (row: Row) => {
    const problems: string[] = [];
    for (const f of files) {
      try { await sendFile(prefill.type, row.id, f); } catch (err) { problems.push(errorMessage(err)); }
    }
    if (prefill.link) {
      try { await api.post('/api/links', { from_type: prefill.type, from_id: row.id, to_type: prefill.link.type, to_id: prefill.link.id }); } catch { /* a link is a convenience */ }
    }
    const label = resource?.label ?? 'Record';
    if (problems.length) toast.error(`${label} ${row.ref ?? ''} saved, but a photo was not: ${problems[0]}`);
    else toast.success(`${label} ${row.ref ?? ''} created.`.replace('  ', ' '));
    onClose();
    if (prefill.type === 'inspection') navigate(`/inspections/${row.id}/run`);
    else if (resource) navigate(`${resource.route}/${row.id}`);
  };
  return (
    <Modal open title={action.label} size="lg" onClose={onClose}>
      {!resource ? <ErrorState title="This form is not available to you" /> : (
        <div className="stack">
          <p className="muted">For {card.typeLabel.toLowerCase()} <strong>{[card.ref, card.title].filter(Boolean).join(' ')}</strong>{card.tagValue ? <> (tag {card.tagValue})</> : null}.</p>
          {WITH_PHOTOS.has(prefill.type) && <PhotoPicker files={files} onChange={setFiles} />}
          <ResourceForm
            type={prefill.type} fields={fields} customFields={false}
            initial={{ ...prefill.values, _display: display }}
            submitLabel={prefill.type === 'inspection' ? 'Start inspection' : prefill.type === 'ticket' || prefill.type === 'safety_event' ? 'Send report' : undefined}
            onCancel={onClose} onSaved={(row) => void saved(row)}
          />
        </div>
      )}
    </Modal>
  );
}

function QuickUpdateDialog({ card, fields, onClose, onSaved }: { card: TagCard; fields: QuickField[]; onClose: () => void; onSaved: () => void }) {
  const resource = useResource(card.recordType);
  const toast = useToast();
  const start = useMemo(() => Object.fromEntries(fields.map((f) => [f.field, f.value ?? null])), [fields]);
  const [values, setValues] = useState<Record<string, unknown>>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = fields.some((f) => (values[f.field] ?? null) !== (start[f.field] ?? null));
  const set = (field: string, v: unknown) => setValues((x) => ({ ...x, [field]: v === '' ? null : v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resource) return;
    const patch = Object.fromEntries(fields.filter((f) => (values[f.field] ?? null) !== (start[f.field] ?? null)).map((f) => [f.field, values[f.field] ?? null]));
    if (!Object.keys(patch).length) { onClose(); return; }
    setBusy(true); setErrors({}); setFormError('');
    try {
      await patchIfMatch(`${resource.path}/${card.recordId}`, card.version, patch);
      toast.success(`${card.typeLabel} updated.`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        setFormError('Someone changed this record after you opened the card. Close this, look at the card again and repeat your change.');
      } else {
        setErrors(err instanceof ApiError ? err.fields : {});
        setFormError(errorMessage(err));
      }
    } finally { setBusy(false); }
  };
  return (
    <Modal open title="Quick update" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {fields.map((f) => {
          const common = { label: f.label, error: errors[f.field] };
          const v = values[f.field];
          if (f.type === 'lookup' && f.list) return <LookupSelect key={f.field} {...common} list={f.list} value={(v as string) ?? ''} onChange={(x) => set(f.field, x)} />;
          if (f.type === 'user') return <UserPicker key={f.field} {...common} value={(v as string) ?? null} display={f.display ?? undefined} onChange={(x) => set(f.field, x)} />;
          if (f.type === 'ref' && f.to) return <RecordPicker key={f.field} {...common} type={f.to} value={(v as string) ?? null} display={f.display ?? undefined} onChange={(x) => set(f.field, x)} />;
          return <TextField key={f.field} {...common} value={(v as string) ?? ''} onChange={(x) => set(f.field, x)} maxLength={200} />;
        })}
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={busy} disabled={!dirty}>Save</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

interface AttachmentRow { id: string; file_name: string; content_type: string; description: string | null }

function PhotoDialog({ card, onClose, onSaved }: { card: TagCard; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data } = useFetch<{ rows: AttachmentRow[] }>(`/api/attachments${qs({ record_type: card.recordType, record_id: card.recordId })}`);
  const images = (data?.rows ?? []).filter((a) => a.content_type?.startsWith('image/'));
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [onCard, setOnCard] = useState(!card.photo);
  const [chosen, setChosen] = useState(card.photo?.attachmentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      let photo = chosen;
      for (const f of files) {
        const sent = await sendFile(card.recordType, card.recordId, f, description || undefined);
        if (onCard && f === files[0]) photo = sent.id;
      }
      if (photo !== (card.photo?.attachmentId ?? '')) {
        await api.put('/api/asset-tags/photo', { recordType: card.recordType, recordId: card.recordId, attachmentId: photo || null });
      }
      toast.success(files.length ? `Photo${files.length > 1 ? 's' : ''} added.` : 'Photo on the card changed.');
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Add photo" onClose={onClose} dirty={files.length > 0}>
      <form className="form" onSubmit={save} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <PhotoPicker files={files} onChange={setFiles} label="Take or choose a photo" />
        {files.length > 0 && <TextField label="Description" hint="What the photo shows, for people who cannot see it." value={description} onChange={setDescription} maxLength={500} />}
        {files.length > 0 && <Checkbox label="Show it on the tag card as the record's photo" checked={onCard} onChange={setOnCard} />}
        {images.length > 0 && files.length === 0 && (
          <Select label="Photo on the tag card" value={chosen}
            options={[{ value: '', label: 'No photo' }, ...images.map((a) => ({ value: a.id, label: a.description ? `${a.file_name}: ${a.description}` : a.file_name }))]}
            onChange={setChosen} />
        )}
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={busy} disabled={!files.length && chosen === (card.photo?.attachmentId ?? '')}>Save</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function NoteDialog({ card, onClose, onSaved }: { card: TagCard; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) { setError('Write the note first.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/api/comments', { record_type: card.recordType, record_id: card.recordId, body, internal: true });
      toast.success('Note added.');
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Add note" onClose={onClose} dirty={Boolean(body.trim())}>
      <form className="form" onSubmit={save} noValidate>
        <TextArea label="Note" hint="An internal note on the record, seen by the people who may see it." value={body} onChange={setBody} rows={4} error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={busy}>Add note</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

interface TaggableType { type: string; label: string; plural: string; canEdit: boolean }

/** Attach a value in stock (or matching a format) to a record (E37-07's attach route). */
function AttachDialog({ value, source, onClose, onSaved }: { value: string; source: FindSource; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: types } = useFetch<TaggableType[]>('/api/asset-tags/taggables');
  const editable = (types ?? []).filter((x) => x.canEdit);
  const [type, setType] = useState('');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!type && editable.length) setType(editable[0].type); }, [type, editable]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!type || !recordId) { setError('Choose the record the tag is stuck on.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/api/asset-tags/attach', { recordType: type, recordId, value, source });
      toast.success(`Tag ${value} attached.`);
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Attach tag ${value}`} onClose={onClose}>
      <form className="form" onSubmit={save} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Select label="Kind of record" required value={type} options={editable.map((x) => ({ value: x.type, label: x.label }))} onChange={(v) => { setType(v); setRecordId(null); }} />
        {type && <RecordPicker key={type} label="Record" required type={type} value={recordId} onChange={(id) => setRecordId(id)} />}
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={busy}>Attach</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- the card ----------

function ActivityLine({ item }: { item: CardActivityItem }) {
  return (
    <li>
      <Link to={item.route}>{item.ref ? <span className="ref">{item.ref}</span> : null} {item.label}</Link>
      <span className="muted">{[item.status, item.date ? formatDate(item.date) : null].filter(Boolean).join(' · ')}</span>
    </li>
  );
}

const LAST_SEEN_HOW: Record<string, string> = { app_code: 'code read by the app', app_text: 'text read by the app', app_typed: 'typed in the app', web: 'on the web' };

export function TagCardView({ card, onChanged }: { card: TagCard; onChanged: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState<TagAction | null>(null);
  const [counting, setCounting] = useState(false);
  const close = () => setOpen(null);
  const done = () => { setOpen(null); onChanged(); };
  const heading = [card.ref, card.title].filter((v, i, a) => v && a.indexOf(v) === i).join(' ');

  const count = async (a: TagAction) => {
    if (!a.countId) return;
    setCounting(true);
    try {
      const r = await api.post<{ message?: string }>(`/api/inventory-counts/${a.countId}/found`, { recordType: card.recordType, recordId: card.recordId });
      toast.success(r?.message || 'Counted.');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && a.webPath) navigate(a.webPath); else toast.error(errorMessage(err));
    } finally { setCounting(false); }
  };
  const run = (a: TagAction) => {
    if (a.key === 'count') { void count(a); return; }
    // A page of its own (the record, the portal's forms, an inspection to run) is opened; a new record
    // with prefilled values, a quick update, a photo or a note is done here in a dialog.
    if (a.webPath) { navigate(a.webPath); return; }
    setOpen(a);
  };

  const facts = [
    { label: card.tagValues.length > 1 ? 'Tag numbers' : 'Tag number', value: card.tagValues.length ? card.tagValues.join(', ') : 'None attached' },
    ...(card.status ? [{ label: 'Status', value: <StatusChip color={card.status.color as never} label={card.status.label} /> }] : []),
    ...(card.site ? [{ label: 'Site', value: <Link to={card.site.route}>{card.site.label}</Link> }] : []),
    ...(card.location ? [{ label: 'Location', value: card.location }] : []),
    ...card.people.map((p) => ({ label: p.label, value: p.name })),
    ...card.facts.map((f) => ({ label: f.label, value: f.value })),
    ...(card.lastSeen ? [{ label: 'Last seen', value: `${relativeTime(card.lastSeen.at)}${card.lastSeen.byName ? ` by ${card.lastSeen.byName}` : ''} (${LAST_SEEN_HOW[card.lastSeen.source] ?? card.lastSeen.source})` }] : []),
  ];
  const act = card.activity;
  const hasActivity = act.openTickets.length > 0 || act.lastInspection || act.lastCondition || act.recentChanges.length > 0;

  return (
    <article className="tag-card" aria-labelledby={`tag-card-${card.recordId}`}>
      <header className="tag-card-head">
        <div className="tag-card-id">
          <span className="tag-card-type"><Icon name={card.recordType === 'vehicle' ? 'bus' : card.recordType === 'site' ? 'map-pin' : card.recordType === 'system' ? 'server' : 'box'} size={16} />{card.typeLabel}</span>
          <h2 id={`tag-card-${card.recordId}`} className="tag-card-title" tabIndex={-1}><Link to={card.route}>{heading}</Link></h2>
          {card.tagValue && <TagValue value={card.tagValue} />}
        </div>
        {card.photo && <img className="tag-card-photo" src={card.photo.url} alt={card.photo.description || `Photo of ${card.title}`} />}
      </header>
      {card.holds.length > 0 && (
        <p className="notice notice-warn" role="note"><Icon name="lock" size={16} /> Under legal hold {card.holds.map((h) => h.ref).join(', ')}: it cannot be changed from here.</p>
      )}
      {card.restricted && <p className="notice" role="note"><Icon name="lock" size={16} /> Restricted record.</p>}

      {card.actions.length > 0 && (
        <nav className="tag-card-actions" aria-label={`What you can do with ${heading}`}>
          {card.actions.map((a, i) => (
            <Button key={a.key} variant={i === 0 && a.key !== 'open' ? 'primary' : 'secondary'} loading={a.key === 'count' && counting} onClick={() => run(a)}>{a.label}</Button>
          ))}
        </nav>
      )}

      <div className="tag-card-body">
        <KeyValue items={facts} compact />
        {hasActivity && (
          <section className="tag-card-activity" aria-label="Recent activity">
            {act.openTickets.length > 0 && (
              <div><h3 className="tag-card-h">Open tickets</h3><ul className="tag-card-list">{act.openTickets.map((x) => <ActivityLine key={x.id} item={x} />)}</ul></div>
            )}
            {act.lastInspection && <div><h3 className="tag-card-h">Last inspection</h3><ul className="tag-card-list"><ActivityLine item={act.lastInspection} /></ul></div>}
            {act.lastCondition && <div><h3 className="tag-card-h">Last condition assessment</h3><ul className="tag-card-list"><ActivityLine item={act.lastCondition} /></ul></div>}
            {act.recentChanges.length > 0 && (
              <div>
                <h3 className="tag-card-h">Recent changes</h3>
                <ul className="tag-card-list">
                  {act.recentChanges.map((c, i) => (
                    <li key={`${c.at}-${i}`}><span>{c.summary}</span><span className="muted"><time dateTime={c.at} title={formatDateTime(c.at)}>{relativeTime(c.at)}</time>{c.byName ? ` · ${c.byName}` : ''}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      {open?.prefill && <NewRecordDialog card={card} action={open} onClose={close} />}
      {open?.key === 'quick_update' && open.fields && <QuickUpdateDialog card={card} fields={open.fields} onClose={close} onSaved={done} />}
      {open?.key === 'add_photo' && <PhotoDialog card={card} onClose={close} onSaved={done} />}
      {open?.key === 'add_note' && <NoteDialog card={card} onClose={close} onSaved={done} />}
    </article>
  );
}

// ---------- the page ----------

interface SearchHit { type: string; typeLabel: string; id: string; label: string; ref: string | null; route: string }

/** For a value nothing answers to: records whose words match it (a reference typed into the global search, for example). */
function OtherMatches({ value }: { value: string }) {
  const { data } = useFetch<SearchHit[]>(value.trim().length >= 2 ? `/api/search${qs({ q: value.trim() })}` : null);
  if (!data?.length) return null;
  return (
    <Card title="Other records matching it">
      <ul className="tag-card-list">
        {data.slice(0, 8).map((h) => (
          <li key={`${h.type}-${h.id}`}><Link to={`${h.route}/${h.id}`}>{h.ref ? <span className="ref">{h.ref}</span> : null} {h.label}</Link><span className="muted">{h.typeLabel}</span></li>
        ))}
      </ul>
    </Card>
  );
}

const TONE: Record<string, string> = { replaced: 'notice-warn', misread: 'notice-warn', in_stock: '', unknown_format: '', identifier: '' };

function ResultView({ result, source, onChanged }: { result: LookupResult; source: FindSource; onChanged: () => void }) {
  const [attaching, setAttaching] = useState<string | null>(null);
  // One record found from a typed number: focus its heading, so a screen reader says what was found. A
  // handheld scanner's value leaves the focus in the box, ready for the next tag.
  const only = source === 'typed' && result.outcome !== 'nothing' && result.cards.length === 1 ? `tag-card-${result.cards[0].recordId}` : null;
  useEffect(() => { if (only) document.getElementById(only)?.focus(); }, [only]);
  if (result.outcome === 'nothing') {
    return (
      <div className="stack">
        <EmptyState icon="search" title={result.message}
          message={result.switchedOff
            ? 'A record holds this tag, but it is in a part of the application that is switched off. An administrator can switch it on under Administration > Features.'
            : 'Check the number on the tag and try again.'} />
        <OtherMatches value={result.candidate.value} />
      </div>
    );
  }
  return (
    <div className="stack">
      {result.outcome !== 'current' && (
        <div className={`notice ${TONE[result.outcome] ?? ''}`} role="status">
          <p>{result.message}</p>
          {result.actions.length > 0 && (
            <div className="row">
              {result.actions.map((a) => <Button key={a.key} variant="primary" onClick={() => setAttaching(a.value ?? result.candidate.value)}>{a.label}</Button>)}
            </div>
          )}
        </div>
      )}
      {result.cards.length > 1 && <p className="muted">{result.cards.length} records match.</p>}
      {result.cards.map((c) => <TagCardView key={`${c.recordType}-${c.recordId}`} card={c} onChanged={onChanged} />)}
      {attaching && <AttachDialog value={attaching} source={source} onClose={() => setAttaching(null)} onSaved={() => { setAttaching(null); onChanged(); }} />}
    </div>
  );
}

export function TagCardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const value = (params.get('value') ?? '').trim();
  const source: FindSource = params.get('source') === 'handheld' ? 'handheld' : 'typed';
  const url = value ? `/api/asset-tags/lookup${qs({ value, source })}` : null;
  const { data, error, reload } = useFetch<LookupResponse>(url);
  const result = data?.results[0];
  const fresh = Boolean(data && result && result.candidate.value.trim() === value);
  return (
    <div className="stack tag-page">
      <PageHeader title="Find by tag number" subtitle="Type the number on an asset tag, or scan it with a handheld scanner." />
      <TagFindForm key={value} initial={value} autoFocus={!value} onFind={(v, s) => navigate(findPath(v, s))} />
      {!value ? null
        : error ? <ErrorState error={error} onRetry={reload} />
          : !fresh || !result ? <Loading lines={5} label="Looking up the tag" />
            : <ResultView result={result} source={source} onChanged={reload} />}
    </div>
  );
}
