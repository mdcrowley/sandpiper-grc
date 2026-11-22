// Administration > Asset tags > Formats (E37-02), with the "try a value" box. Owner: TAGS-CORE.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, Icon, Loading, Modal,
  NumberField, PageHeader, Select, StatusChip, TableWrap, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import { AssetTagsTabs } from './AdminTabs';
import type { CheckScheme, TagCarrier, TagCharacters, TagFormat, TagFormatInput, TagSource, TryFormatResult } from './api';

export const CHARACTER_OPTIONS: { value: TagCharacters; label: string }[] = [
  { value: 'digits', label: 'Digits only' },
  { value: 'alphanumeric', label: 'Letters and digits' },
  { value: 'pattern', label: 'A pattern (advanced)' },
];
export const CHECK_OPTIONS: { value: CheckScheme; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'mod10', label: 'Mod 10 (Luhn)' },
  { value: 'mod11', label: 'Mod 11' },
  { value: 'mod36', label: 'Mod 36 (letters and digits)' },
];
export const CARRIER_OPTIONS: { value: TagCarrier; label: string }[] = [
  { value: 'any', label: 'Any way' },
  { value: 'text', label: 'Printed text only' },
  { value: 'code', label: 'A barcode or 2D code only' },
  { value: 'both', label: 'Both text and a code' },
];
const SOURCE_OPTIONS: { value: TagSource; label: string }[] = [
  { value: 'typed', label: 'Typed' },
  { value: 'handheld', label: 'Handheld scanner' },
  { value: 'text', label: 'Text read by the app' },
  { value: 'code', label: 'Code read by the app' },
];
export const TAGGABLE_TYPES = ['asset', 'site', 'system', 'vehicle'];

const labelOf = <T extends string>(options: { value: T; label: string }[], v: T) => options.find((o) => o.value === v)?.label ?? v;

function lengthText(f: TagFormat): string {
  if (f.lengthMin === null && f.lengthMax === null) return 'Any';
  if (f.lengthMin !== null && f.lengthMax !== null) return f.lengthMin === f.lengthMax ? String(f.lengthMin) : `${f.lengthMin} to ${f.lengthMax}`;
  return f.lengthMin !== null ? `${f.lengthMin} or more` : `Up to ${f.lengthMax}`;
}

interface Draft {
  name: string; characters: TagCharacters; pattern: string; prefix: string; lengthMin: number | null; lengthMax: number | null;
  checkCharacter: CheckScheme; carrier: TagCarrier; extractPattern: string; recordTypes: string[]; active: boolean;
}
const EMPTY: Draft = { name: '', characters: 'digits', pattern: '', prefix: '', lengthMin: null, lengthMax: null, checkCharacter: 'none', carrier: 'any', extractPattern: '', recordTypes: [], active: true };
const draftOf = (f: TagFormat): Draft => ({ ...f, pattern: f.pattern ?? '', extractPattern: f.extractPattern ?? '' });

export function FormatsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { resources } = useMeta();
  const manage = can('tags.manage');
  const { data, error, reload } = useFetch<TagFormat[]>('/api/asset-tags/formats');
  const [editing, setEditing] = useState<TagFormat | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<TagFormat | null>(null);
  const typeOptions = TAGGABLE_TYPES.filter((t) => resources[t]).map((t) => ({ value: t, label: resources[t].plural }));
  const typeNames = (types: string[]) => (types.length ? types.map((t) => resources[t]?.plural ?? t).join(', ') : 'All');

  const open = (f: TagFormat | 'new') => { setEditing(f); setDraft(f === 'new' ? EMPTY : draftOf(f)); setErrors({}); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = editing !== null && JSON.stringify(draft) !== JSON.stringify(editing === 'new' ? EMPTY : draftOf(editing));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: TagFormatInput = {
      ...draft, pattern: draft.characters === 'pattern' ? draft.pattern : null, extractPattern: draft.extractPattern.trim() || null,
    };
    try {
      if (editing === 'new') await api.post('/api/asset-tags/formats', body);
      else if (editing) await api.patch(`/api/asset-tags/formats/${editing.id}`, body);
      toast.success('Tag format saved.');
      setEditing(null);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/asset-tags/formats/${removing.id}`);
      toast.success('Tag format removed.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Asset tags"
        subtitle="What your organization's tags look like. Formats are optional; they let the app trust printed text it reads and refuse misreads."
        actions={manage ? <Button variant="primary" icon="plus" onClick={() => open('new')}>Add format</Button> : undefined}
      />
      <AssetTagsTabs />
      <Card title="Tag formats" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={3} label="Loading tag formats" /></div>
          : data.length === 0 ? (
            <EmptyState
              icon="tag" title="No tag formats"
              message="Without a format, a barcode or 2D code is accepted as it is, and printed text read by the app is used only once the person confirms it."
              action={manage ? <Button icon="plus" onClick={() => open('new')}>Add format</Button> : undefined}
            />
          ) : (
            <TableWrap label="Tag formats">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th><th scope="col">Characters</th><th scope="col">Prefix</th><th scope="col">Length after the prefix</th>
                    <th scope="col">Check character</th><th scope="col">Carried as</th><th scope="col">Record types</th><th scope="col">Status</th>
                    {manage && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id}>
                      <td>{f.name}{f.characters === 'pattern' && f.pattern && <div className="muted tg-value">{f.pattern}</div>}</td>
                      <td>{labelOf(CHARACTER_OPTIONS, f.characters)}</td>
                      <td>{f.prefix ? <span className="tg-value">{f.prefix}</span> : <span className="muted">None</span>}</td>
                      <td>{lengthText(f)}</td>
                      <td>{labelOf(CHECK_OPTIONS, f.checkCharacter)}</td>
                      <td>{labelOf(CARRIER_OPTIONS, f.carrier)}{f.extractPattern && <div className="muted">Value taken from codes</div>}</td>
                      <td>{typeNames(f.recordTypes)}</td>
                      <td>{f.active ? <StatusChip color="green" label="Active" /> : <StatusChip color="gray" label="Off" />}</td>
                      {manage && (
                        <td className="tg-actions">
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => open(f)} aria-label={`Edit ${f.name}`}>Edit</Button>
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(f)} aria-label={`Remove ${f.name}`}>Remove</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      {data && data.length > 0 && <TryValue formats={data} />}

      <Modal open={editing !== null} title={editing === 'new' ? 'Add tag format' : 'Edit tag format'} onClose={() => setEditing(null)} dirty={dirty} size="lg">
        <form className="form" onSubmit={submit} noValidate>
          <div className="form-grid">
            <TextField label="Name" required maxLength={80} value={draft.name} onChange={(v) => set('name', v)} error={errors.name} hint="For example Equipment tags." />
            <Select label="Characters" required value={draft.characters} onChange={(v) => set('characters', v as TagCharacters)} options={CHARACTER_OPTIONS} error={errors.characters} />
            {draft.characters === 'pattern' && (
              <div className="form-cell-wide">
                <TextField
                  label="Pattern" required maxLength={120} value={draft.pattern} onChange={(v) => set('pattern', v)} error={errors.pattern}
                  hint="Matched against the whole value in capitals without spaces or dashes, for example ^K\d[A-Z]\d[A-Z]\d$. Allowed: letters and digits, . \d \w [A-Z], one repeat per item (? * + {n} {n,m}), ^ and $; at most 120 characters."
                />
              </div>
            )}
            <TextField label="Prefix" maxLength={20} value={draft.prefix} onChange={(v) => set('prefix', v)} error={errors.prefix} hint="Printed before the number, for example TA-. Optional." />
            <Select label="Check character" value={draft.checkCharacter} onChange={(v) => set('checkCharacter', v as CheckScheme)} options={CHECK_OPTIONS} error={errors.checkCharacter} hint="The last character checks the others, as many bought tags have." />
            <NumberField label="Shortest length after the prefix" min={1} max={200} step={1} value={draft.lengthMin} onChange={(v) => set('lengthMin', v)} error={errors.lengthMin} hint="Check character included. Leave empty for any." />
            <NumberField label="Longest length after the prefix" min={1} max={200} step={1} value={draft.lengthMax} onChange={(v) => set('lengthMax', v)} error={errors.lengthMax} hint="The same as the shortest for an exact length." />
            <Select label="How tags carry the value" value={draft.carrier} onChange={(v) => set('carrier', v as TagCarrier)} options={CARRIER_OPTIONS} error={errors.carrier} hint="Applies to what the app's camera reads; typed values are checked by shape only." />
            <TextField
              label="Part of a code that is the value" maxLength={120} value={draft.extractPattern} onChange={(v) => set('extractPattern', v)} error={errors.extractPattern}
              hint="For codes holding more than the value: a pattern with the value in brackets, for example ID=(\d+). Optional."
            />
            <div className="form-cell-wide">
              <ChoicesField label="Record types" value={draft.recordTypes} onChange={(v) => set('recordTypes', v)} options={typeOptions} placeholder="All" error={errors.recordTypes} hint="Leave empty for every kind of record." />
            </div>
            <div className="form-cell-wide">
              <Checkbox label="Active" checked={draft.active} onChange={(v) => set('active', v)} hint="Formats that are off are kept but not used." />
            </div>
          </div>
          <div className="form-actions">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)} danger busy={busy} title="Remove this tag format?" confirmLabel="Remove"
        message={removing ? `"${removing.name}" will no longer check tag values. Stock or a series that uses it keeps it; switch it off instead in that case.` : ''}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/** "Try a value": whether and how a value matches each format. */
function TryValue({ formats }: { formats: TagFormat[] }) {
  const [value, setValue] = useState('');
  const [source, setSource] = useState<TagSource>('typed');
  const [result, setResult] = useState<TryFormatResult | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const names = new Map(formats.map((f) => [f.id, f]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) { setProblem('Type a value to try.'); return; }
    setBusy(true);
    setProblem('');
    try {
      setResult(await api.post<TryFormatResult>('/api/asset-tags/formats/try', { value, source }));
    } catch (err) {
      setProblem(err instanceof ApiError && err.fields?.value ? err.fields.value : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Try a value">
      <form className="tg-try" onSubmit={submit} noValidate>
        <TextField label="Tag value" value={value} onChange={(v) => { setValue(v); setResult(null); }} maxLength={2000} error={problem || undefined} placeholder="For example TA-118342" />
        <Select label="Read as" value={source} onChange={(v) => { setSource(v as TagSource); setResult(null); }} options={SOURCE_OPTIONS} />
        <Button type="submit" variant="primary" loading={busy}>Try</Button>
      </form>
      <div aria-live="polite">
        {result && (
          <>
            <p className="muted">Compared as <span className="tg-value">{result.key || '(nothing)'}</span>.</p>
            <ul className="tg-try-results">
              {result.results.map((r) => (
                <li key={r.formatId}>
                  <Icon name={r.ok ? 'check-circle' : 'alert-circle'} label={r.ok ? 'Matches' : 'Does not match'} />
                  <span><strong>{r.name}</strong>{names.get(r.formatId)?.active === false && <> <Badge color="gray">Off</Badge></>}: {r.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
