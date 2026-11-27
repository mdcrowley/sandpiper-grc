// Findings by identifier (E45-36): the same finding seen on several hosts is one row, most urgent
// first; opening a row lists each host's finding with its status, and selected hosts can be
// assigned, accepted, closed or put on one change together.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, Badge, Button, Card, Checkbox, EmptyState, ErrorState, formatDate, Loading, PageHeader, StatusChip, TableWrap, TextField, useFetch,
} from '../../core';
import type { Row } from '../../core';
import { AcceptRiskDialog, AssignDialog, FalsePositiveDialog, FixedDialog } from './Dialogs';
import { groupLink, SectionTabs, SeverityChip, useRaiseChange, useVulnAccess } from './shared';

interface Group {
  key: string; title: string; plugin_id: string | null; cves: string | null; hosts: number; open: number; closed: number; overdue: number;
  unassigned: number; oldest_age: number | null; earliest_due: string | null; known_exploited: boolean; urgency: number; severity: string | null;
}
interface GroupPage { rows: Group[]; total: number; page: number; pageSize: number }
interface HostFinding {
  id: string; ref: string; title: string; host_name: string | null; host_ip: string | null; port: string | null; protocol: string | null;
  severity: string; status: string; status_label: string; closed: boolean; overdue: boolean; urgency: number; known_exploited: boolean;
  due_on: string | null; fixed_on: string | null; age_days: number; owner_id: string | null; owner_name: string | null; system_label: string | null;
}
interface GroupDetail {
  key: string; title: string; plugin_id: string | null; cves: string | null; solution: string | null; open: number; hosts: number; findings: HostFinding[];
}

const identity = (g: { plugin_id: string | null; cves: string | null }) =>
  [g.plugin_id ? `Finding ID ${g.plugin_id}` : null, g.cves].filter(Boolean).join(' · ');

export function GroupsPage() {
  const [params] = useSearchParams();
  const key = params.get('key');
  return key ? <GroupView groupKey={key} /> : <GroupList />;
}

function GroupList() {
  const [q, setQ] = useState('');
  const [multi, setMulti] = useState(true);
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(1);
  const url = `/api/vulnerabilities/groups?${new URLSearchParams({ q: q.trim(), multi: String(multi), status: all ? 'all' : 'open', page: String(page) })}`;
  const { data, error, reload } = useFetch<GroupPage>(url);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="stack">
      <PageHeader title="Findings by identifier" subtitle="One row per finding ID (or CVE) with every host it is on, most urgent first."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'By finding' }]} />
      <SectionTabs active="groups" />
      <div className="vuln-group-filters">
        <TextField label="Search" type="search" value={q} placeholder="Title, finding ID or CVE" onChange={(v) => { setQ(v); setPage(1); }} />
        <Checkbox label="Only findings on more than one host" checked={multi} onChange={(v) => { setMulti(v); setPage(1); }} />
        <Checkbox label="Include findings closed on every host" checked={all} onChange={(v) => { setAll(v); setPage(1); }} />
      </div>
      {error && !data ? <ErrorState title="The findings could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Loading findings" />
        : data.rows.length === 0 ? (
          <Card>
            <EmptyState icon="check-circle" title={multi ? 'No finding is open on more than one host' : 'No open findings'}
              message={multi ? 'Clear "Only findings on more than one host" to see every finding.' : 'Findings that match appear here, one row per identifier.'} />
          </Card>
        ) : (
          <Card flush>
            <TableWrap label="Findings by identifier" fit className="vuln-tw">
              <table className="table vuln-wrap">
                <caption className="sr-only">Findings by identifier, most urgent first</caption>
                <thead>
                  <tr>
                    <th scope="col">Finding</th>
                    <th scope="col">Worst severity</th>
                    <th scope="col" className="num">Hosts</th>
                    <th scope="col" className="num">Open</th>
                    <th scope="col" className="num" data-priority="2">Overdue</th>
                    <th scope="col" className="num" data-priority="3">Unassigned</th>
                    <th scope="col" className="num" data-priority="3">Oldest (days)</th>
                    <th scope="col" data-priority="2">Earliest fix by</th>
                    <th scope="col" className="num" data-priority="3">Urgency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((g) => (
                    <tr key={g.key}>
                      <th scope="row" className="vuln-title-cell">
                        <span className="vuln-title-cell">
                          <Link className="row-title" to={groupLink(g.key)}>{g.title}</Link>
                          {g.known_exploited && <Badge color="red">Known exploited</Badge>}
                        </span>
                        {identity(g) && <div className="muted vuln-sub">{identity(g)}</div>}
                      </th>
                      <td><SeverityChip value={g.severity} /></td>
                      <td className="num">{g.hosts}</td>
                      <td className="num">{g.open}{g.closed > 0 && <span className="muted"> of {g.open + g.closed}</span>}</td>
                      <td className="num">{g.overdue ? <Badge color="red">{g.overdue}</Badge> : 0}</td>
                      <td className="num">{g.unassigned}</td>
                      <td className="num">{g.oldest_age ?? '—'}</td>
                      <td>{g.earliest_due ? formatDate(g.earliest_due) : <span className="muted">No date</span>}</td>
                      <td className="num">{g.urgency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      {data && pages > 1 && (
        <div className="row vuln-pager">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="muted">Page {page} of {pages} · {data.total} findings</span>
          <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

type BulkDialog = 'assign' | 'fixed' | 'accept' | 'false_positive';

function GroupView({ groupKey }: { groupKey: string }) {
  const access = useVulnAccess();
  const change = useRaiseChange();
  const { data, error, reload } = useFetch<GroupDetail>(`/api/vulnerabilities/group?key=${encodeURIComponent(groupKey)}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<BulkDialog | null>(null);
  const [raising, setRaising] = useState(false);
  const crumbs = [{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'By finding', to: '/vulnerabilities/groups' }, { label: data?.title ?? 'Finding' }];
  const openIds = useMemo(() => (data?.findings ?? []).filter((f) => !f.closed).map((f) => f.id), [data]);

  if (error && !data) {
    return <div className="stack"><PageHeader title="Finding" breadcrumbs={crumbs} /><SectionTabs active="groups" />
      <ErrorState title="The finding could not be loaded" error={error} onRetry={reload} /></div>;
  }
  if (!data) return <div className="stack"><PageHeader title="Finding" breadcrumbs={crumbs} /><SectionTabs active="groups" /><Loading lines={6} label="Loading the finding" /></div>;

  const ids = [...selected].filter((id) => data.findings.some((f) => f.id === id));
  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const allOpen = openIds.length > 0 && openIds.every((id) => selected.has(id));
  /** The dialogs save one patch; here it goes to every selected finding, and what a rule refused is listed. */
  const saveAll = async (patch: Record<string, unknown>) => {
    const res = await api.post<{ updated: number; failed: { ref: string | null; message: string }[] }>('/api/vulnerabilities/bulk', { ids, patch });
    reload();
    if (res.failed.length) {
      throw new Error(`${res.updated} saved. Not saved: ${res.failed.map((f) => `${f.ref ?? 'a finding'}: ${f.message}`).join(' ')}`);
    }
    setSelected(new Set());
  };
  const raise = async (list: string[]) => {
    setRaising(true);
    try { await change.raise(list); } finally { setRaising(false); }
  };

  return (
    <div className="stack">
      <PageHeader
        title={data.title}
        subtitle={`${[identity(data), `${data.hosts} host${data.hosts === 1 ? '' : 's'}`, `${data.open} open`].filter(Boolean).join(' · ')}`}
        breadcrumbs={crumbs}
        actions={change.available && openIds.length > 0
          ? <Button variant="primary" icon="refresh" loading={raising} onClick={() => void raise(ids.length ? ids : openIds)}>
            {ids.length ? `Raise a change for ${ids.length} selected` : 'Raise a change for every open host'}
          </Button>
          : undefined}
      />
      <SectionTabs active="groups" />
      {data.solution && (
        <Card title="Solution given by the scanner"><p className="vuln-pre">{data.solution}</p></Card>
      )}
      <Card flush title="Hosts with this finding"
        actions={access.edit && (
          <div className="row vuln-bulk" role="group" aria-label="Actions for the selected findings">
            <span className="muted">{ids.length} selected</span>
            <Button size="sm" icon="user" disabled={!ids.length} onClick={() => setDialog('assign')}>Assign</Button>
            <Button size="sm" icon="check" disabled={!ids.length} onClick={() => setDialog('fixed')}>Mark fixed</Button>
            <Button size="sm" icon="scale" disabled={!ids.length} onClick={() => setDialog('accept')}>Accept the risk</Button>
            <Button size="sm" icon="x" disabled={!ids.length} onClick={() => setDialog('false_positive')}>False positive</Button>
          </div>
        )}>
        <TableWrap label="Hosts with this finding" fit className="vuln-tw">
          <table className="table vuln-wrap">
            <caption className="sr-only">Each host with this finding, open ones first</caption>
            <thead>
              <tr>
                {access.edit && (
                  <th scope="col">
                    <input type="checkbox" aria-label="Select every open finding" checked={allOpen} disabled={!openIds.length}
                      onChange={(e) => setSelected(e.currentTarget.checked ? new Set(openIds) : new Set())} />
                  </th>
                )}
                <th scope="col">Host</th>
                <th scope="col">Finding</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col" data-priority="2">Owner</th>
                <th scope="col">Fix by</th>
                <th scope="col" data-priority="3">System</th>
                <th scope="col" className="num" data-priority="3">Age (days)</th>
              </tr>
            </thead>
            <tbody>
              {data.findings.map((f) => {
                const host = f.host_name || f.host_ip || '—';
                return (
                  <tr key={f.id}>
                    {access.edit && (
                      <td><input type="checkbox" aria-label={`Select ${f.ref} on ${host}`} checked={selected.has(f.id)} onChange={(e) => toggle(f.id, e.currentTarget.checked)} /></td>
                    )}
                    <th scope="row" className="vuln-host-cell">
                      {host}
                      {(f.port || (f.host_name && f.host_ip)) && <div className="muted vuln-sub">{[f.host_name && f.host_ip, f.port].filter(Boolean).join(' · ')}</div>}
                    </th>
                    <td><Link to={`/vulnerabilities/${f.id}`}>{f.ref}</Link>{f.known_exploited && !f.closed && <> <Badge color="red">Known exploited</Badge></>}</td>
                    <td><SeverityChip value={f.severity} /></td>
                    <td><StatusChip color={f.closed ? 'gray' : 'blue'} label={f.status_label} size="sm" /></td>
                    <td>{f.owner_name ?? <span className="muted">Unassigned</span>}</td>
                    <td>
                      {f.closed ? <span className="muted">{f.fixed_on ? `Fixed ${formatDate(f.fixed_on)}` : 'Closed'}</span>
                        : f.due_on ? <span className="vuln-due">{formatDate(f.due_on)}{f.overdue && <Badge color="red">Overdue</Badge>}</span>
                        : <span className="muted">No date</span>}
                    </td>
                    <td>{f.system_label ?? <span className="muted">—</span>}</td>
                    <td className="num">{f.age_days}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      {dialog && (() => {
        const close = () => setDialog(null);
        const row: Row = { id: '' };
        if (dialog === 'assign') return <AssignDialog row={row} save={saveAll} onClose={close} />;
        if (dialog === 'fixed') return <FixedDialog row={row} save={saveAll} onClose={close} />;
        if (dialog === 'accept') return <AcceptRiskDialog row={row} save={saveAll} onClose={close} />;
        return <FalsePositiveDialog row={row} save={saveAll} onClose={close} />;
      })()}
    </div>
  );
}
