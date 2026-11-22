// Administration > Asset tags > Stock (E37-03): ranges and lists of bought or printed tags, and the
// values of one range. Owner: TAGS-CORE.
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, type ColorName, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, formatNumber,
  KeyValue, Loading, Modal, NumberField, PageHeader, qs, Select, StatusChip, TableWrap, TextArea, TextField, useAuth, useDebounced, useFetch, useToast,
} from '../../core';
import { AssetTagsTabs } from './AdminTabs';
import { cleanValue, sequenceValue, type StockRange, type StockRangeInput, type StockValuesPage, type StockValueState, type TagFormat } from './api';

const STATE_LABEL: Record<StockValueState, { label: string; color: ColorName }> = {
  available: { label: 'Available', color: 'green' },
  attached: { label: 'Attached', color: 'blue' },
  replaced: { label: 'Replaced', color: 'gray' },
  void: { label: 'Void', color: 'red' },
  lost: { label: 'Lost', color: 'amber' },
};
const MAX_FILE = 2 * 1024 * 1024;

/** The values in a text or CSV file: one a line, or separated by commas, semicolons or tabs; a header line "value" is skipped. */
export function valuesFromText(text: string): string[] {
  return text.split(/[\r\n,;\t]+/).map((v) => cleanValue(v.replace(/^"|"$/g, ''))).filter((v, i) => v && !(i === 0 && /^(tag ?)?values?$|^tag( number)?$/i.test(v)));
}

function Counts({ r }: { r: StockRange }) {
  return (
    <span className="tg-counts">
      <Badge color="blue">{formatNumber(r.counts.attached)} attached</Badge>
      <Badge color="green">{formatNumber(r.counts.available)} available</Badge>
      {r.counts.void > 0 && <Badge color="red">{formatNumber(r.counts.void)} void</Badge>}
      {r.counts.lost > 0 && <Badge color="amber">{formatNumber(r.counts.lost)} lost</Badge>}
    </span>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const manage = can('tags.manage');
  const { data, error, reload } = useFetch<StockRange[]>('/api/asset-tags/ranges');
  const [adding, setAdding] = useState(false);

  return (
    <div className="stack">
      <PageHeader
        title="Tag stock"
        subtitle="Tags your organization has bought or printed. A number in stock is available until it is attached to a record."
        actions={manage ? <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Register tags</Button> : undefined}
      />
      <AssetTagsTabs />
      <Card title="Ranges and lists" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={3} label="Loading tag stock" /></div>
          : data.length === 0 ? (
            <EmptyState
              icon="box" title="No tag stock registered"
              message="When a box of tags arrives, register its numbers here, for example 010000 to 010999. Stock is optional."
              action={manage ? <Button icon="plus" onClick={() => setAdding(true)}>Register tags</Button> : undefined}
            />
          ) : (
            <TableWrap label="Tag stock">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Values</th><th scope="col">Kind</th><th scope="col" className="num">How many</th><th scope="col">State</th>
                    <th scope="col">Format</th><th scope="col">Received</th><th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/admin/asset-tags/stock/${r.id}`}><span className="tg-value">{r.firstValue}</span>{r.size > 1 && <> to <span className="tg-value">{r.lastValue}</span></>}</Link></td>
                      <td>{r.kind === 'sequence' ? 'Range' : 'List'}, {r.source}</td>
                      <td className="num">{formatNumber(r.size)}</td>
                      <td><Counts r={r} /></td>
                      <td>{r.formatName ?? <span className="muted">None</span>}</td>
                      <td>{r.receivedOn ? formatDate(r.receivedOn) : <span className="muted">Not recorded</span>}</td>
                      <td>{[r.supplierNote, r.note].filter(Boolean).join(' · ') || <span className="muted">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      {adding && <RegisterDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </div>
  );
}

function RegisterDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: formats } = useFetch<TagFormat[]>('/api/asset-tags/formats');
  const [kind, setKind] = useState<'sequence' | 'list'>('sequence');
  const [formatId, setFormatId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [digits, setDigits] = useState<number | null>(6);
  const [first, setFirst] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [listText, setListText] = useState('');
  const [source, setSource] = useState<'bought' | 'printed'>('bought');
  const [supplierNote, setSupplierNote] = useState('');
  const [note, setNote] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const format = formats?.find((f) => f.id === formatId) ?? null;
  const values = useMemo(() => valuesFromText(listText), [listText]);
  const preview = kind === 'sequence' && digits && first !== null && last !== null && first <= last
    ? `${sequenceValue(first, { prefix: prefix || format?.prefix || '', digits, checkCharacter: format?.checkCharacter })} to ${sequenceValue(last, { prefix: prefix || format?.prefix || '', digits, checkCharacter: format?.checkCharacter })} (${formatNumber(last - first + 1)} tags)`
    : null;
  const dirty = Boolean(first !== null || last !== null || listText || supplierNote || note);

  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) { setErrors({ values: 'Choose a file of at most 2 MB.' }); return; }
    setListText(valuesFromText(await file.text()).join('\n'));
    setErrors({});
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem('');
    const common = { formatId: formatId || null, source, supplierNote, note, receivedOn: receivedOn || null };
    const body: StockRangeInput = kind === 'sequence'
      ? { kind, ...common, prefix: prefix || format?.prefix || '', digits: digits ?? 0, first: first ?? -1, last: last ?? -1 }
      : { kind, ...common, values };
    try {
      await api.post('/api/asset-tags/ranges', body);
      toast.success('Tags registered.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Register tags" onClose={onClose} dirty={dirty} size="lg">
      <form className="form" onSubmit={submit} noValidate>
        {problem && <div className="notice notice-warn" role="alert">{problem}</div>}
        <div className="form-grid">
          <Select
            label="What arrived" required value={kind} onChange={(v) => { setKind(v as 'sequence' | 'list'); setErrors({}); }}
            options={[{ value: 'sequence', label: 'A range of numbers' }, { value: 'list', label: 'A list of values (not in sequence)' }]}
          />
          <Select
            label="Format" value={formatId} onChange={setFormatId} error={errors.formatId} placeholder="None"
            options={[{ value: '', label: 'None' }, ...(formats ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.name }))]}
            hint="The values are checked against it; its check character is added to each number."
          />
          {kind === 'sequence' ? (
            <>
              <TextField label="Prefix" maxLength={20} value={prefix} onChange={setPrefix} error={errors.prefix} placeholder={format?.prefix || 'None'} hint="Printed before the number, for example TA-." />
              <NumberField label="Digits" required min={1} max={18} step={1} value={digits} onChange={setDigits} error={errors.digits} hint="Numbers are zero-padded to this width: 6 makes 10000 into 010000." />
              <NumberField label="First number" required min={0} step={1} value={first} onChange={setFirst} error={errors.first} />
              <NumberField label="Last number" required min={0} step={1} value={last} onChange={setLast} error={errors.last} />
              {preview && <p className="form-cell-wide muted" aria-live="polite">Registers {preview}.</p>}
            </>
          ) : (
            <div className="form-cell-wide stack">
              <TextArea
                label="Values" required rows={6} value={listText} onChange={setListText} error={errors.values}
                hint={`One value a line, or separated by commas. ${values.length ? `${formatNumber(values.length)} values.` : ''}`}
              />
              <div>
                <label className="btn btn-secondary btn-sm" htmlFor="tg-list-file">Read values from a file</label>
                <input id="tg-list-file" className="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void readFile(e)} />
                <span className="muted"> A text or CSV file of at most 2 MB.</span>
              </div>
            </div>
          )}
          <Select label="Source" value={source} onChange={(v) => setSource(v as 'bought' | 'printed')} options={[{ value: 'bought', label: 'Bought' }, { value: 'printed', label: 'Printed' }]} error={errors.source} />
          <DateField label="Received on" value={receivedOn} onChange={setReceivedOn} error={errors.receivedOn} />
          <TextField label="Supplier note" maxLength={500} value={supplierNote} onChange={setSupplierNote} error={errors.supplierNote} hint="For example an order or box number." />
          <TextField label="Note" maxLength={500} value={note} onChange={setNote} error={errors.note} />
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Register</Button>
        </div>
      </form>
    </Modal>
  );
}

export function RangePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('tags.manage');
  const { data: ranges, error: rangesError, reload: reloadRanges } = useFetch<StockRange[]>('/api/asset-tags/ranges');
  const range = ranges?.find((r) => r.id === id);
  const [state, setState] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, error, reload } = useFetch<StockValuesPage>(range ? `/api/asset-tags/ranges/${id}/values${qs({ state, q, page, pageSize })}` : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState<'void' | 'lost' | 'available' | null>(null);
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  if (rangesError) return <ErrorState error={rangesError} onRetry={reloadRanges} />;
  if (!ranges) return <Loading label="Loading tag stock" />;
  if (!range) {
    return (
      <div className="stack">
        <PageHeader title="Tag stock" breadcrumbs={[{ label: 'Tag stock', to: '/admin/asset-tags/stock' }]} />
        <EmptyState icon="box" title="Tag stock not found" message="It may have been removed." action={<Link className="btn btn-secondary" to="/admin/asset-tags/stock">Back to tag stock</Link>} />
      </div>
    );
  }
  const title = range.size > 1 ? `${range.firstValue} to ${range.lastValue}` : range.firstValue;
  const markable = (s: StockValueState) => s === 'available' || s === 'void' || s === 'lost';
  const toggle = (v: string) => setPicked((p) => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  const refresh = () => { setPicked(new Set()); reload(); reloadRanges(); };

  const mark = async () => {
    if (!marking) return;
    setBusy(true);
    try {
      const res = await api.post<{ marked: number }>('/api/asset-tags/stock/mark', { values: [...picked], status: marking, reason: reason || undefined });
      toast.success(`${res.marked} ${res.marked === 1 ? 'value' : 'values'} marked ${marking}.`);
      setMarking(null);
      setReason('');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/asset-tags/ranges/${range.id}`);
      toast.success('Tag stock removed.');
      navigate('/admin/asset-tags/stock');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title={title}
        subtitle={`${range.kind === 'sequence' ? 'Range' : 'List'} of ${formatNumber(range.size)} ${range.source} tags`}
        breadcrumbs={[{ label: 'Asset tags', to: '/admin/asset-tags' }, { label: 'Tag stock', to: '/admin/asset-tags/stock' }]}
        actions={manage ? (
          <>
            <Button icon="edit" onClick={() => setEditing(true)}>Edit notes</Button>
            <Button icon="trash" variant="danger" onClick={() => setRemoving(true)} disabled={range.counts.attached > 0} title={range.counts.attached > 0 ? 'Values of this stock are attached to records' : undefined}>Remove</Button>
          </>
        ) : undefined}
      />
      <Card>
        <KeyValue layout="columns" items={[
          { label: 'State', value: <Counts r={range} /> },
          { label: 'Format', value: range.formatName },
          { label: 'Received', value: range.receivedOn ? formatDate(range.receivedOn) : null },
          { label: 'Supplier note', value: range.supplierNote },
          { label: 'Note', value: range.note },
          { label: 'Registered', value: `${formatDate(range.createdAt)}${range.createdByName ? ` by ${range.createdByName}` : ''}` },
        ]} />
      </Card>
      <Card title="Values" flush>
        <div className="card-body tg-toolbar">
          <TextField label="Find a value" type="search" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Part of a value" />
          <Select
            label="State" value={state} onChange={(v) => { setState(v); setPage(1); }} placeholder="Every state"
            options={[{ value: '', label: 'Every state' }, ...Object.entries(STATE_LABEL).map(([value, s]) => ({ value, label: s.label }))]}
          />
          {manage && picked.size > 0 && (
            <>
              <span className="muted" aria-live="polite">{picked.size} chosen</span>
              <Button size="sm" onClick={() => setMarking('void')}>Mark void</Button>
              <Button size="sm" onClick={() => setMarking('lost')}>Mark lost</Button>
              <Button size="sm" onClick={() => setMarking('available')}>Mark available</Button>
            </>
          )}
        </div>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={5} label="Loading values" /></div>
          : data.rows.length === 0 ? <EmptyState icon="search" title="No values" message="No value of this stock matches." />
          : (
            <>
              <TableWrap label="Values">
                <table className="table">
                  <thead>
                    <tr>
                      {manage && <th scope="col"><span className="sr-only">Choose</span></th>}
                      <th scope="col">Value</th><th scope="col">State</th><th scope="col">Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((v) => (
                      <tr key={v.key}>
                        {manage && (
                          <td>{markable(v.state) && <input type="checkbox" aria-label={`Choose ${v.value}`} checked={picked.has(v.value)} onChange={() => toggle(v.value)} />}</td>
                        )}
                        <td className="tg-value">{v.value}</td>
                        <td><StatusChip color={STATE_LABEL[v.state].color} label={STATE_LABEL[v.state].label} /></td>
                        <td>{v.route ? <Link to={v.route}>{v.recordLabel}</Link> : v.state === 'attached' || v.state === 'replaced' ? <span className="muted">A record you cannot see</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="card-body row">
                <span className="muted">{formatNumber(data.total)} {data.total === 1 ? 'value' : 'values'}</span>
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span>Page {page} of {Math.max(1, Math.ceil(data.total / pageSize))}</span>
                <Button size="sm" disabled={page * pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </>
          )}
      </Card>
      <Modal open={marking !== null} title={marking === 'available' ? 'Mark available again' : `Mark ${marking}`} size="sm" onClose={() => setMarking(null)}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void mark(); }} noValidate>
          <p>{picked.size} {picked.size === 1 ? 'value' : 'values'}: {[...picked].slice(0, 5).join(', ')}{picked.size > 5 ? ' and more' : ''}.</p>
          {marking !== 'available' && <TextField label="Reason" maxLength={500} value={reason} onChange={setReason} hint="For example: torn when unpacked." />}
          <div className="form-actions">
            <Button onClick={() => setMarking(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Mark</Button>
          </div>
        </form>
      </Modal>
      {editing && <NotesDialog range={range} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadRanges(); }} />}
      <ConfirmDialog
        open={removing} danger busy={busy} title="Remove this tag stock?" confirmLabel="Remove"
        message="Its values are no longer known as yours (looking one up says it is not in your tag stock). The removal is recorded in the audit log."
        onConfirm={() => void remove()} onCancel={() => setRemoving(false)}
      />
    </div>
  );
}

function NotesDialog({ range, onClose, onSaved }: { range: StockRange; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [supplierNote, setSupplierNote] = useState(range.supplierNote ?? '');
  const [note, setNote] = useState(range.note ?? '');
  const [receivedOn, setReceivedOn] = useState(range.receivedOn ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/api/asset-tags/ranges/${range.id}`, { supplierNote, note, receivedOn: receivedOn || null });
      toast.success('Notes saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const dirty = supplierNote !== (range.supplierNote ?? '') || note !== (range.note ?? '') || receivedOn !== (range.receivedOn ?? '');
  return (
    <Modal open title="Edit notes" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Supplier note" maxLength={500} value={supplierNote} onChange={setSupplierNote} error={errors.supplierNote} />
        <TextField label="Note" maxLength={500} value={note} onChange={setNote} error={errors.note} />
        <DateField label="Received on" value={receivedOn} onChange={setReceivedOn} error={errors.receivedOn} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
