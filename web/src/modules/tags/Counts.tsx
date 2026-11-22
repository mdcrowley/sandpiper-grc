// Inventory counts (E37-09): the list, one count (counting by typing or a handheld scanner, finishing,
// deciding what to do with the differences) and the report. Owner: TAGS-COUNTS.
// A handheld scanner in keyboard mode types the tag's value and Enter into the Tag number box, which
// keeps the focus after each find, so a shelf of equipment can be scanned one tag after another.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, Checkbox, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDateTime, Loading, Modal, PageHeader,
  ProgressBar, RecordPage, RecordPicker, relativeTime, ResourceList, Select, Stat, StatusChip, TableWrap, TextField, useAuth,
  useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import type { CountFinishResult, CountFoundResult, CountItems, CountItemView } from './api';
import './counts.css';

interface Countable { type: string; label: string; hasLocation: boolean }
type Raised = { type: 'ticket' | 'action'; id: string; ref: string | null };

const STATE_LABEL: Record<string, { label: string; color: 'gray' | 'green' | 'red' | 'amber' | 'blue' }> = {
  pending: { label: 'Still to find', color: 'gray' },
  found: { label: 'Found', color: 'green' },
  missing: { label: 'Missing', color: 'red' },
  unexpected: { label: 'Unexpected', color: 'amber' },
};
const RESOLUTION_LABEL: Record<string, string> = { moved: 'Moved here', marked_missing: 'Marked missing', left: 'Left as it is' };
const OUTCOME_COLOR: Record<CountFoundResult['outcome'], 'green' | 'blue' | 'amber' | 'red'> = { found: 'green', already_found: 'blue', unexpected: 'amber', not_found: 'red' };
const OUTCOME_LABEL: Record<CountFoundResult['outcome'], string> = { found: 'Found', already_found: 'Already found', unexpected: 'Unexpected', not_found: 'Not found' };

const stateOf = (i: CountItemView) => (!i.expected ? 'unexpected' : i.state);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- Starting a count ---------- */

function StartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const kinds = useFetch<{ types: Countable[] }>(open ? '/api/inventory-counts/countable' : null);
  const [site, setSite] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(site || area || types.length || title);
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const row = await api.post<{ id: string }>('/api/inventory-counts/start', { site_id: site, area: area || null, record_types: types, title: title || null });
      toast.success('Count started. The records expected at the site are listed.');
      onClose();
      navigate(`/inventory-counts/${row.id}`);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  const list = kinds.data?.types ?? [];
  const areaPossible = list.some((k) => k.hasLocation && (!types.length || types.includes(k.type)));
  return (
    <Modal open={open} title="Start an inventory count" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!site} onClick={submit}>Start the count</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="muted cnt-hint">The records registered at the site are listed as expected when the count starts; what is added later is not.</p>
        <div className="form-grid">
          <div className="form-cell-wide">
            <RecordPicker label="Site" type="site" value={site} onChange={(id) => setSite(id)} placeholder="Search the sites" required error={errors.site_id} />
          </div>
          <TextField label="Room or area (optional)" value={area} onChange={setArea} maxLength={200} error={errors.area}
            hint={areaPossible ? 'Only records whose location contains this text are expected.' : 'None of the chosen kinds has a location.'} />
          <TextField label="Title (optional)" value={title} onChange={setTitle} maxLength={300} hint="Default: the site, the area and today's date." error={errors.title} />
          <fieldset className="form-cell-wide cnt-kinds">
            <legend>What to count</legend>
            {kinds.error ? <ErrorState error={kinds.error} onRetry={kinds.reload} /> : !kinds.data ? <Loading lines={2} label="Loading the kinds of record" /> : list.map((k) => (
              <Checkbox key={k.type} label={k.label} checked={types.includes(k.type)}
                onChange={(on) => setTypes((cur) => (on ? [...cur, k.type] : cur.filter((x) => x !== k.type)))} />
            ))}
            <p className="muted cnt-hint">{errors.record_types ?? 'Choose none to count every kind.'}</p>
          </fieldset>
        </div>
      </form>
    </Modal>
  );
}

function useStartDialog() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const close = () => {
    setOpen(false);
    if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); }
  };
  return { open, show: () => setOpen(true), close };
}

export function CountListPage() {
  const { can } = useAuth();
  const dialog = useStartDialog();
  const counting = can('tags.count');
  return (
    <div className="stack">
      <PageHeader title="Inventory counts" subtitle="Check that what the register says is at a site is really there: count the tags you find, then deal with what is missing or out of place." />
      <ResourceList
        type="inventory_count"
        urlState
        columns={['ref', 'title', 'site_id', 'area', 'status', 'started_at', 'started_by', { field: 'finished_at', hidden: true }]}
        filters={['status', 'site_id', 'started_by', 'started_at']}
        bulkFields={[]}
        actions={<>
          <Link className="btn btn-secondary" to="/inventory-counts/report">Report</Link>
          {counting && <Button variant="primary" icon="plus" onClick={dialog.show}>Start a count</Button>}
        </>}
      />
      {counting && <StartDialog open={dialog.open} onClose={dialog.close} />}
    </div>
  );
}

/* ---------- One count ---------- */

/** The Tag number box: typed, or a handheld scanner's value and Enter. Keeps the focus for the next tag. */
function CountBox({ countId, onFound }: { countId: string; onFound: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<(CountFoundResult & { at: number; value: string })[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const refocus = () => box.current?.querySelector('input')?.focus();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const res = await api.post<CountFoundResult>(`/api/inventory-counts/${countId}/found`, { value: v, source: 'typed' });
      setRecent((cur) => [{ ...res, at: Date.now(), value: v }, ...cur].slice(0, 6));
      setValue('');
      if (res.outcome !== 'not_found') onFound();
    } catch (err) {
      setRecent((cur) => [{ outcome: 'not_found' as const, item: null, message: errorMessage(err), at: Date.now(), value: v }, ...cur].slice(0, 6));
    } finally {
      setBusy(false);
      refocus();
    }
  };
  const last = recent[0];
  return (
    <Card title="Count">
      <form className="cnt-box" onSubmit={submit} aria-label="Count a tag">
        <div ref={box} className="cnt-box-field">
          <TextField label="Tag number" value={value} onChange={setValue} autoFocus autoComplete="off" maxLength={200}
            hint="Type the tag number, or scan it with a handheld scanner, then Enter." leftSection={undefined} />
        </div>
        <Button type="submit" variant="primary" icon="check" loading={busy} disabled={!value.trim()}>Found</Button>
      </form>
      <div role="status" aria-live="polite" className="cnt-last">
        {last && <><StatusChip color={OUTCOME_COLOR[last.outcome]} label={OUTCOME_LABEL[last.outcome]} /> <span>{last.message}</span></>}
      </div>
      {recent.length > 1 && (
        <ul className="cnt-recent" aria-label="Earlier in this session">
          {recent.slice(1).map((r) => (
            <li key={r.at}><span className="muted">{r.value}</span> {OUTCOME_LABEL[r.outcome]}{r.item ? `: ${r.item.label}` : ''}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Totals({ totals }: { totals: CountItems['totals'] }) {
  return (
    <div className="cnt-stats">
      <Stat size="sm" label="Expected" value={totals.expected} />
      <Stat size="sm" label="Found" value={totals.found} color="green" />
      <Stat size="sm" label="Still to find" value={totals.pending} />
      <Stat size="sm" label="Missing" value={totals.missing} color={totals.missing ? 'red' : undefined} />
      <Stat size="sm" label="Unexpected" value={totals.unexpected} color={totals.unexpected ? 'amber' : undefined} />
    </div>
  );
}

const FILTERS = [
  { value: '', label: 'Every item' },
  { value: 'pending', label: 'Still to find' },
  { value: 'found', label: 'Found' },
  { value: 'unexpected', label: 'Unexpected' },
  { value: 'missing', label: 'Missing' },
];

function Items({ rec, items, reload }: { rec: RecordContext; items: ReturnType<typeof useFetch<CountItems>>; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const open = rec.row.status === 'open';
  const finished = rec.row.status === 'finished';
  const counting = can('tags.count');
  if (items.error && !items.data) return <ErrorState error={items.error} onRetry={reload} />;
  if (!items.data) return <Loading lines={6} label="Loading the items" />;
  const rows = items.data.rows.filter((i) => !filter || stateOf(i) === filter);
  const decidable = (i: CountItemView) => finished && counting && !i.resolution && (i.state === 'missing' || !i.expected);
  const markFound = async (i: CountItemView) => {
    setBusy(i.id);
    try {
      const res = await api.post<CountFoundResult>(`/api/inventory-counts/${rec.row.id}/found`, { recordType: i.recordType, recordId: i.recordId });
      toast.success(res.message);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const resolve = async (resolution: 'moved' | 'marked_missing' | 'left') => {
    setBusy(resolution);
    try {
      const res = await api.post<{ resolved: number; refused: { label: string; message: string }[] }>(`/api/inventory-counts/${rec.row.id}/resolve`, { itemIds: chosen, resolution });
      if (res.resolved) toast.success(`${plural(res.resolved, 'record')} ${RESOLUTION_LABEL[resolution].toLowerCase()}.`);
      for (const r of res.refused) toast.error(`${r.label}: ${r.message}`);
      setChosen([]);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const chosenItems = items.data.rows.filter((i) => chosen.includes(i.id));
  return (
    <div className="stack">
      <div className="cnt-bar">
        <Select label="Show" value={filter} onChange={setFilter} options={FILTERS} />
        {finished && counting && (
          <div className="cnt-decide" role="group" aria-label="Decide for the chosen items">
            <Button icon="map-pin" disabled={!chosenItems.length || chosenItems.some((i) => i.expected)} loading={busy === 'moved'} onClick={() => resolve('moved')}>Move here</Button>
            <Button icon="alert" disabled={!chosenItems.length || chosenItems.some((i) => !i.expected)} loading={busy === 'marked_missing'} onClick={() => resolve('marked_missing')}>Mark missing</Button>
            <Button variant="ghost" disabled={!chosenItems.length} loading={busy === 'left'} onClick={() => resolve('left')}>Leave as it is</Button>
          </div>
        )}
      </div>
      {rows.length === 0 ? <EmptyState icon="check-square" title="Nothing to show" message={filter ? 'No item is in this state.' : 'This count expects nothing, and nothing has been found yet.'} /> : (
        <TableWrap label="Items of the count">
          <table className="table">
            <caption className="sr-only">Items of the count</caption>
            <thead>
              <tr>
                {finished && counting && <th scope="col"><span className="sr-only">Choose</span></th>}
                <th scope="col">Record</th><th scope="col">Tag number</th><th scope="col">State</th><th scope="col">Found</th><th scope="col">Decision</th>
                {open && counting && <th scope="col"><span className="sr-only">Mark found</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const s = STATE_LABEL[stateOf(i)];
                return (
                  <tr key={i.id}>
                    {finished && counting && (
                      <td>{decidable(i) && <Checkbox label={`Choose ${i.label}`} className="cnt-check" checked={chosen.includes(i.id)}
                        onChange={(on) => setChosen((cur) => (on ? [...cur, i.id] : cur.filter((x) => x !== i.id)))} />}</td>
                    )}
                    <td>{i.route ? <Link to={i.route}>{i.label}</Link> : <span className="muted">{i.label}</span>}{i.ref && <span className="muted"> {i.ref}</span>}</td>
                    <td>{i.tagValue ?? <span className="muted">None</span>}</td>
                    <td><StatusChip color={s.color} label={s.label} size="sm" /></td>
                    <td>{i.foundAt ? <span title={formatDateTime(i.foundAt)}>{relativeTime(i.foundAt)}{i.foundByName ? ` by ${i.foundByName}` : ''}</span> : '—'}</td>
                    <td>{i.resolution ? RESOLUTION_LABEL[i.resolution] : '—'}</td>
                    {open && counting && (
                      <td>{i.state === 'pending' && i.route && <Button size="sm" variant="ghost" loading={busy === i.id} onClick={() => markFound(i)} aria-label={`Mark ${i.label} found`}>Mark found</Button>}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

function Differences({ row, reload }: { row: RecordContext['row']; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const raised: Raised[] = Array.isArray(row.summary?.raised) ? row.summary.raised : [];
  const raise = async (kind: 'ticket' | 'action') => {
    setBusy(kind);
    try {
      const res = await api.post<{ route: string; ref: string | null }>(`/api/inventory-counts/${row.id}/raise`, { kind });
      toast.success(`${kind === 'ticket' ? 'Ticket' : 'Action'} ${res.ref ?? ''} raised with the list of differences.`);
      reload();
      navigate(res.route);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const mayTicket = can('tickets.create');
  const mayAction = can('actions.create');
  if (!can('tags.count') || (!mayTicket && !mayAction)) return null;
  const s = row.summary ?? {};
  if (!s.missing && !s.unexpected) return <p className="muted cnt-hint">Everything expected was found, and nothing was out of place.</p>;
  return (
    <div className="cnt-raise">
      <span>Follow up the differences:</span>
      {mayTicket && <Button icon="ticket" loading={busy === 'ticket'} onClick={() => raise('ticket')}>Raise a ticket</Button>}
      {mayAction && <Button icon="check-square" loading={busy === 'action'} onClick={() => raise('action')}>Raise an action</Button>}
      {raised.length > 0 && <span className="muted">Raised so far: {raised.map((r) => <Link key={r.id} to={`/${r.type === 'ticket' ? 'tickets' : 'actions'}/${r.id}`}>{r.ref ?? r.type}</Link>).reduce<ReactNode[]>((a, l, n) => (n ? [...a, ', ', l] : [l]), [])}</span>}
    </div>
  );
}

function CountHeaderActions({ rec, onChanged }: { rec: RecordContext; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [ask, setAsk] = useState<'finish' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  if (rec.row.status !== 'open' || !can('tags.count')) return null;
  const go = async () => {
    setBusy(true);
    try {
      if (ask === 'finish') {
        const res = await api.post<CountFinishResult>(`/api/inventory-counts/${rec.row.id}/finish`);
        toast.success(`Count finished: ${res.summary.found} of ${res.summary.expected} found, ${res.summary.missing} missing, ${res.summary.unexpected} unexpected.`);
      } else {
        await api.post(`/api/inventory-counts/${rec.row.id}/cancel`);
        toast.success('Count canceled.');
      }
      setAsk(null);
      rec.reload();
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="ghost" onClick={() => setAsk('cancel')}>Cancel the count</Button>
      <Button variant="primary" icon="check" onClick={() => setAsk('finish')}>Finish</Button>
      <ConfirmDialog
        open={ask !== null}
        title={ask === 'finish' ? 'Finish this count?' : 'Cancel this count?'}
        message={ask === 'finish'
          ? 'What has not been found is marked missing. Nobody can count toward it afterward.'
          : 'Nobody can count toward it afterward. What was found keeps its last verified date.'}
        confirmLabel={ask === 'finish' ? 'Finish the count' : 'Cancel the count'}
        cancelLabel="Keep counting"
        danger={ask === 'cancel'}
        busy={busy}
        onConfirm={go}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}

function CountBanner({ rec, items, reload }: { rec: RecordContext; items: ReturnType<typeof useFetch<CountItems>>; reload: () => void }) {
  const { can } = useAuth();
  const kinds = useFetch<{ types: Countable[] }>('/api/inventory-counts/countable');
  const totals = items.data?.totals;
  const chosen: string[] = Array.isArray(rec.row.record_types) ? rec.row.record_types : [];
  const names = chosen.length ? chosen.map((t) => kinds.data?.types.find((k) => k.type === t)?.label ?? t).join(', ') : 'Every kind of record kept at the site';
  return (
    <div className="stack">
      <p className="muted cnt-hint">Counting: {names}{rec.row.area ? `, in ${rec.row.area}` : ''}.</p>
      {totals && (
        <>
          <ProgressBar value={totals.found} max={Math.max(totals.expected, 1)} label="Expected records found" valueText={`${totals.found} of ${totals.expected}`} color="green" />
          <Totals totals={totals} />
        </>
      )}
      {rec.row.status === 'open' && can('tags.count') && <CountBox countId={rec.row.id} onFound={reload} />}
      {rec.row.status === 'finished' && <Differences row={rec.row} reload={rec.reload} />}
    </div>
  );
}

export function CountDetailPage() {
  // Bumped after each find, finish or decision: the banner and the Items tab read the items again.
  const [tick, setTick] = useState(0);
  const reload = () => setTick((n) => n + 1);
  return (
    <RecordPage
      type="inventory_count"
      actions={(rec) => <CountHeaderActions rec={rec} onChanged={reload} />}
      banner={(rec) => <LiveCount rec={rec} tick={tick} reload={reload} part="banner" />}
      summaryFields={['title', 'site_id', 'area', 'started_at', 'started_by', 'finished_at', 'finished_by', 'notes']}
      tabs={[{ key: 'items', label: 'Items', content: (rec) => <LiveCount rec={rec} tick={tick} reload={reload} part="items" /> }]}
    />
  );
}

/** Items of the count, re-read every 15 seconds while it is open, so people counting together see each other's finds. */
function LiveCount({ rec, tick, reload, part }: { rec: RecordContext; tick: number; reload: () => void; part: 'banner' | 'items' }) {
  const [poll, setPoll] = useState(0);
  const open = rec.row.status === 'open';
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setPoll((n) => n + 1); }, 15_000);
    return () => window.clearInterval(timer);
  }, [open]);
  const items = useFetch<CountItems>(`/api/inventory-counts/${rec.row.id}/items?v=${tick}.${poll}.${String(rec.row.updated_at ?? '')}`, { keepPrevious: true });
  return part === 'banner' ? <CountBanner rec={rec} items={items} reload={reload} /> : <Items rec={rec} items={items} reload={reload} />;
}

/* ---------- Report ---------- */

interface Report {
  days: number;
  counts: { open: number; finished: number; canceled: number };
  sites: { siteId: string; siteLabel: string; records: number; verified: number; coverage: number; lastCountAt: string | null; lastCountId: string | null; lastCountRef: string | null; openCounts: number }[];
  stale: { total: number; rows: { recordType: string; typeLabel: string; recordId: string; label: string; ref: string | null; route: string; siteId: string | null; siteLabel: string | null; lastVerifiedAt: string | null }[] };
}

const PERIODS = [
  { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last year' }, { value: '730', label: 'Last 2 years' },
];

export function CountReportPage() {
  const [params, setParams] = useSearchParams();
  const days = params.get('days') ?? '365';
  const site = params.get('site') ?? '';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const { data, error, reload } = useFetch<Report>(`/api/inventory-counts/report?days=${days}${site ? `&site=${site}` : ''}`, { keepPrevious: true });
  const period = PERIODS.find((p) => p.value === days)?.label.toLowerCase() ?? `the last ${days} days`;
  return (
    <div className="stack">
      <PageHeader title="Inventory count report" subtitle="Counts, how much of each site was verified, and what has not been seen in a count for a while."
        breadcrumbs={[{ label: 'Inventory counts', to: '/inventory-counts' }, { label: 'Report' }]} />
      <Card>
        <div className="cnt-bar">
          <Select label="Verified within" value={days} onChange={(v) => set('days', v)} options={PERIODS} />
          <Select label="Site (records not verified)" value={site} onChange={(v) => set('site', v)}
            options={[{ value: '', label: 'Every site' }, ...(data?.sites ?? []).map((s) => ({ value: s.siteId, label: s.siteLabel }))]} />
        </div>
      </Card>
      {error && !data ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={8} label="Loading the report" /> : (
        <>
          <div className="cnt-stats">
            <Stat label="Open counts" value={data.counts.open} to="/inventory-counts?f.status=open" />
            <Stat label="Finished counts" value={data.counts.finished} to="/inventory-counts?f.status=finished" />
            <Stat label="Canceled counts" value={data.counts.canceled} />
          </div>
          <Card title="Coverage by site" flush>
            {data.sites.length === 0 ? <EmptyState icon="map-pin" title="No site holds countable records" message="Records appear here once assets, vehicles or sites are registered." /> : (
              <TableWrap label="Coverage by site">
                <table className="table">
                  <caption className="sr-only">Coverage by site: records verified in a count, {period}</caption>
                  <thead><tr><th scope="col">Site</th><th scope="col" className="num">Records</th><th scope="col" className="num">Verified</th><th scope="col">Coverage</th><th scope="col">Last finished count</th><th scope="col" className="num">Open counts</th></tr></thead>
                  <tbody>
                    {data.sites.map((s) => (
                      <tr key={s.siteId}>
                        <td><Link to={`/sites/${s.siteId}`}>{s.siteLabel}</Link></td>
                        <td className="num">{s.records}</td>
                        <td className="num">{s.verified}</td>
                        <td className="cnt-cover"><ProgressBar value={s.coverage} label={`Coverage of ${s.siteLabel}`} hideLabel valueText={`${s.coverage}%`} color={s.coverage >= 90 ? 'green' : s.coverage >= 50 ? 'amber' : 'red'} size="sm" className="cnt-cover-bar" /><span className="cnt-cover-pct">{s.coverage}%</span></td>
                        <td>{s.lastCountId ? <Link to={`/inventory-counts/${s.lastCountId}`}>{s.lastCountRef ?? 'Count'}</Link> : <span className="muted">Never counted</span>}{s.lastCountAt && <span className="muted"> {relativeTime(s.lastCountAt)}</span>}</td>
                        <td className="num">{s.openCounts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title={`Not verified ${period} (${data.stale.total})`} flush>
            {data.stale.rows.length === 0 ? <EmptyState icon="check-circle" title="Everything was verified" message={`Every record you may see was found in a count ${period}.`} /> : (
              <TableWrap label="Records not verified">
                <table className="table">
                  <caption className="sr-only">Records not verified in a count, {period}, never verified first</caption>
                  <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">Site</th><th scope="col">Last verified</th></tr></thead>
                  <tbody>
                    {data.stale.rows.map((r) => (
                      <tr key={`${r.recordType}:${r.recordId}`}>
                        <td><Link to={r.route}>{r.label}</Link>{r.ref && <span className="muted"> {r.ref}</span>}</td>
                        <td>{r.typeLabel}</td>
                        <td>{r.siteLabel ?? '—'}</td>
                        <td>{r.lastVerifiedAt ? <span title={formatDateTime(r.lastVerifiedAt)}>{relativeTime(r.lastVerifiedAt)}</span> : <span className="muted">Never</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {data.stale.total > data.stale.rows.length && <p className="muted cnt-hint cnt-pad">Showing the first {data.stale.rows.length} of {data.stale.total}.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
