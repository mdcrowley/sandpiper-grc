import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, humanize, Icon, IconButton, Loading,
  PageHeader, qs, relativeTime, Select, TableWrap, TextField, todayInZone, useDebounced, useFetch, useMeta, UserPicker, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { AuditDiff, FilterPills, Pager } from './common';
import type { AuditEvent, FilterPill } from './common';

/** An audit event with the token and request that made it, when there were any. */
type Event = AuditEvent & { token_name?: string | null; request_id?: string | null };

const PAGE_SIZE = 50;
const CORE_TYPES = ['user', 'role', 'setting', 'lookup', 'department'];
/** Pages for the record types that are not ordinary records. */
const CORE_ROUTES: Record<string, string> = { user: '/admin/users', role: '/admin/roles' };

export function AuditLogPage() {
  const toast = useToast();
  const { resources } = useMeta();
  // A link from elsewhere (a person's page, for example) may arrive with filters already chosen.
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [action, setAction] = useState(params.get('action') ?? '');
  const [recordType, setRecordType] = useState(params.get('record_type') ?? '');
  const [recordId, setRecordId] = useState(params.get('record_id') ?? '');
  const [requestId, setRequestId] = useState(params.get('request_id') ?? '');
  const [actor, setActor] = useState<{ id: string; label: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(q.trim(), 300);
  const actionSearch = useDebounced(action.trim(), 300);
  const requestSearch = useDebounced(requestId.trim(), 300);

  // Dates are whole days in the organization's time zone.
  const filters = {
    q: search, action: actionSearch, record_type: recordType, record_id: recordId, actor_id: actor?.id, request_id: requestSearch,
    from: from ? `${from} 00:00:00` : '', to: to ? `${to} 23:59:59.999` : '',
  };
  const { data, error, loading, reload } = useFetch<ListResult<Event>>(`/api/audit${qs({ ...filters, page, pageSize: PAGE_SIZE })}`, { keepPrevious: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const first = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const clear = () => { setQ(''); setAction(''); setRecordType(''); setRecordId(''); setRequestId(''); setActor(null); setFrom(''); setTo(''); setPage(1); };
  const typeLabel = (t: string) => resources?.[t]?.label ?? humanize(t);

  const typeOptions = [...new Set([...CORE_TYPES, ...Object.keys(resources ?? {})])].sort()
    .map((t) => ({ value: t, label: typeLabel(t) }));

  const pills: FilterPill[] = [];
  if (q.trim()) pills.push({ key: 'q', label: 'Search', value: q.trim(), onRemove: () => first(setQ)('') });
  if (action.trim()) pills.push({ key: 'action', label: 'Action', value: action.trim(), onRemove: () => first(setAction)('') });
  if (recordType) pills.push({ key: 'type', label: 'Record type', value: typeLabel(recordType), onRemove: () => { setRecordType(''); setRecordId(''); setPage(1); } });
  if (recordId) pills.push({ key: 'record', label: 'Record', value: recordId.length > 13 ? `${recordId.slice(0, 8)}…` : recordId, onRemove: () => first(setRecordId)('') });
  if (requestId.trim()) pills.push({ key: 'request', label: 'Request', value: requestId.trim().length > 13 ? `${requestId.trim().slice(0, 8)}…` : requestId.trim(), onRemove: () => first(setRequestId)('') });
  if (actor) pills.push({ key: 'actor', label: 'Done by', value: actor.label || 'One person', onRemove: () => first(setActor)(null) });
  if (from) pills.push({ key: 'from', label: 'From', value: formatDate(from), onRemove: () => first(setFrom)('') });
  if (to) pills.push({ key: 'to', label: 'To', value: formatDate(to), onRemove: () => first(setTo)('') });
  const filtered = pills.length > 0;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.blob(`/api/audit${qs({ ...filters, format: 'csv' })}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${todayInZone()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded. The export itself has been recorded.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const toggle = (id: number) => setOpen((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const recordLink = (e: Event) => {
    if (!e.record_type || !e.record_id) return null;
    const route = CORE_ROUTES[e.record_type] ?? resources?.[e.record_type]?.route;
    return route ? `${route}/${e.record_id}` : null;
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, change, export and permission change: who, when, from where, and the values before and after. Entries cannot be edited or deleted."
        actions={
          <Button icon="download" loading={exporting} disabled={!data || data.total === 0} onClick={() => void exportCsv()}
            title={filtered ? 'Downloads every event that matches the filters' : 'Downloads every event, up to the newest 50,000'}>
            Export CSV
          </Button>
        }
      />
      <Card className="adm-filters">
        <div className="adm-toolbar adm-toolbar-flush">
          <TextField className="adm-toolbar-grow" label="Search" type="search" placeholder="Summary, person or action" leftSection={<Icon name="search" size={16} />} value={q} onChange={first(setQ)} />
          <TextField label="Action" placeholder="For example signin.failure" value={action} onChange={first(setAction)} />
          <Select label="Record type" placeholder="Any type" options={typeOptions} value={recordType} onChange={(v) => { setRecordType(v); setRecordId(''); setPage(1); }} />
          <TextField label="Request id" placeholder="From an X-Request-Id header" value={requestId} onChange={first(setRequestId)} />
          <UserPicker label="Done by" placeholder="Anyone" value={actor?.id ?? null} display={actor?.label}
            onChange={(id, option) => { setActor(id ? { id, label: option?.label ?? '' } : null); setPage(1); }} />
          <DateField label="From" value={from} max={to || undefined} onChange={first(setFrom)} />
          <DateField label="To" value={to} min={from || undefined} onChange={first(setTo)} />
        </div>
      </Card>
      <FilterPills pills={pills} onClear={clear} />
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={8} label="Loading audit log" /></div>
          : data.rows.length === 0 ? (
            <EmptyState icon="history" title={filtered ? 'No events match these filters' : 'No events yet'}
              message={filtered ? 'Widen the dates or remove a filter.' : 'Events appear as soon as anyone signs in or changes something.'}
              action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined} />
          ) : (
            <>
              <TableWrap label="Audit events" className={`adm-table-frame${loading ? ' table-loading' : ''}`} aria-busy={loading}>
                <table className="table adm-audit">
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Details</span></th><th scope="col">When</th><th scope="col">Who</th>
                      <th scope="col">What happened</th><th scope="col">Record</th><th scope="col">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((e) => {
                      const expanded = open.has(e.id);
                      const href = recordLink(e);
                      const hasValues = e.before != null || e.after != null;
                      return (
                        <Fragment key={e.id}>
                          <tr className={expanded ? 'adm-audit-open' : undefined}>
                            <td className="adm-audit-toggle">
                              <IconButton size="sm" variant="ghost" icon={expanded ? 'chevron-down' : 'chevron-right'}
                                label={expanded ? 'Hide details' : 'Show details'} aria-expanded={expanded} aria-controls={`audit-${e.id}`} onClick={() => toggle(e.id)} />
                            </td>
                            <td title={relativeTime(e.at)}>{formatDateTime(e.at)}</td>
                            <td>{e.actor_name ?? (e.ip ? <span className="muted">Not signed in</span> : <span className="muted">System</span>)}</td>
                            <td className="adm-wrap">
                              <div>{e.summary ?? humanize(e.action.replace(/[.]/g, '_'))}</div>
                              <div className="adm-audit-meta">
                                <code>{e.action}</code>
                                {hasValues && <span className="chip chip-gray">Values recorded</span>}
                              </div>
                            </td>
                            <td>{e.record_type ? typeLabel(e.record_type) : <span className="muted">—</span>}</td>
                            <td>{e.ip ?? <span className="muted">—</span>}</td>
                          </tr>
                          {expanded && (
                            <tr className="adm-expanded" id={`audit-${e.id}`}>
                              <td />
                              <td colSpan={5} className="adm-wrap">
                                <AuditDiff before={e.before} after={e.after} recordType={e.record_type} />
                                <div className="adm-audit-foot">
                                  <span className="muted">
                                    Event {e.id}{e.record_id ? ` · record ${e.record_id}` : ''}
                                    {e.token_name ? ` · token “${e.token_name}”` : ''}
                                    {e.request_id ? ` · request ${e.request_id}` : ''}
                                  </span>
                                  {href && <Link to={href}>Open the {typeLabel(e.record_type!).toLowerCase()}</Link>}
                                  {action.trim() !== e.action && <Button size="sm" variant="ghost" icon="filter" onClick={() => first(setAction)(e.action)}>Only “{e.action}” events</Button>}
                                  {e.record_type && e.record_id && recordId !== e.record_id && (
                                    <Button size="sm" variant="ghost" icon="filter" onClick={() => { setRecordType(e.record_type!); setRecordId(e.record_id!); setPage(1); }}>Only this record</Button>
                                  )}
                                  {e.request_id && requestId.trim() !== e.request_id && (
                                    <Button size="sm" variant="ghost" icon="filter" onClick={() => first(setRequestId)(e.request_id!)}>Everything this request did</Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
              <Pager
                summary={`${data.total.toLocaleString('en-US')} ${data.total === 1 ? 'event' : 'events'}, newest first`}
                page={page} pages={pages} onPage={setPage} previous="Newer" next="Older"
              />
            </>
          )}
      </Card>
    </>
  );
}
