import { Fragment, useState } from 'react';
import {
  api, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDateTime, humanize, IconButton, Loading,
  PageHeader, qs, Select, TextField, useDebounced, useFetch, useMeta, UserPicker, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { AuditDiff } from './common';
import type { AuditEvent } from './common';

const PAGE_SIZE = 50;
const CORE_TYPES = ['user', 'role', 'setting', 'lookup', 'department'];

export function AuditLogPage() {
  const toast = useToast();
  const { resources } = useMeta();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [recordType, setRecordType] = useState('');
  const [actor, setActor] = useState<{ id: string; label: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(q, 300);
  const actionSearch = useDebounced(action.trim(), 300);

  // Dates are whole days in the application's time zone (the server reads them as Eastern time).
  const filters = {
    q: search, action: actionSearch, record_type: recordType, actor_id: actor?.id,
    from: from ? `${from} 00:00:00` : '', to: to ? `${to} 23:59:59.999` : '',
  };
  const { data, error, loading, reload } = useFetch<ListResult<AuditEvent>>(`/api/audit${qs({ ...filters, page, pageSize: PAGE_SIZE })}`);
  const filtered = Object.values(filters).some(Boolean);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const first = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const clear = () => { setQ(''); setAction(''); setRecordType(''); setActor(null); setFrom(''); setTo(''); setPage(1); };

  const typeOptions = [...new Set([...CORE_TYPES, ...Object.keys(resources ?? {})])].sort()
    .map((t) => ({ value: t, label: resources?.[t]?.label ?? humanize(t) }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.blob(`/api/audit${qs({ ...filters, format: 'csv' })}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
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

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, change, export and permission change: who, when, from where, and the values before and after. Entries cannot be edited or deleted."
        actions={<Button icon="download" loading={exporting} disabled={!data || data.total === 0} onClick={() => void exportCsv()}>Export CSV</Button>}
      />
      <div className="adm-toolbar">
        <TextField className="adm-toolbar-grow" label="Search" type="search" placeholder="Summary, person or action" value={q} onChange={first(setQ)} />
        <TextField label="Action" placeholder="e.g. signin.failure" value={action} onChange={first(setAction)} hint="Exact action name" />
        <Select label="Record type" placeholder="Any type" options={typeOptions} value={recordType} onChange={first(setRecordType)} />
        <UserPicker label="Done by" placeholder="Anyone" value={actor?.id ?? null} display={actor?.label}
          onChange={(id, option) => { setActor(id ? { id, label: option?.label ?? '' } : null); setPage(1); }} />
        <DateField label="From" value={from} max={to || undefined} onChange={first(setFrom)} />
        <DateField label="To" value={to} min={from || undefined} onChange={first(setTo)} />
        {filtered && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>
      <Card flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={8} label="Loading audit log" /></div>
          : data.rows.length === 0 ? (
            <EmptyState icon="history" title={filtered ? 'No events match these filters' : 'No events yet'}
              message={filtered ? 'Widen the dates or clear the filters.' : 'Events appear as soon as anyone signs in or changes something.'} />
          ) : (
            <>
              <div className="table-wrap" aria-busy={loading}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col"><span className="sr-only">Details</span></th><th scope="col">When</th><th scope="col">Who</th>
                      <th scope="col">Action</th><th scope="col">What happened</th><th scope="col">Record</th><th scope="col">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((e) => {
                      const expanded = open.has(e.id);
                      return (
                        <Fragment key={e.id}>
                          <tr>
                            <td>
                              <IconButton size="sm" variant="ghost" icon={expanded ? 'chevron-down' : 'chevron-right'}
                                label={expanded ? 'Hide details' : 'Show details'} aria-expanded={expanded} onClick={() => toggle(e.id)} />
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.at)}</td>
                            <td>{e.actor_name ?? (e.ip ? <span className="muted">Not signed in</span> : 'System')}</td>
                            <td><code>{e.action}</code></td>
                            <td>{e.summary ?? '—'}</td>
                            <td>{e.record_type ? (resources?.[e.record_type]?.label ?? humanize(e.record_type)) : '—'}</td>
                            <td>{e.ip ?? '—'}</td>
                          </tr>
                          {expanded && (
                            <tr className="adm-expanded">
                              <td />
                              <td colSpan={6}>
                                <p className="muted">Event {e.id}{e.record_id ? ` · record ${e.record_id}` : ''}</p>
                                <AuditDiff before={e.before} after={e.after} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="adm-foot">
                <span className="muted">{data.total.toLocaleString('en-US')} {data.total === 1 ? 'event' : 'events'}, newest first</span>
                <span className="row">
                  <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
                  <span>Page {page} of {pages}</span>
                  <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button>
                </span>
              </div>
            </>
          )}
      </Card>
    </>
  );
}
