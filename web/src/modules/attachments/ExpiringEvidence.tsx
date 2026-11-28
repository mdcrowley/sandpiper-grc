// One page for expiring evidence (E44-08): vendor evidence items, records of the evidence library and
// evidence files attached to any record, soonest first, with a filter by source. Each source is shown only
// while its area is on and the person may view it; what they may not see is simply not listed (lists, not
// figures). It is the Expiring tab under Vendors > Evidence and under the Evidence library.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card, cx, EmptyState, ErrorState, errorMessage, formatDate, listQuery, Loading, PageHeader, routePaths, Select, Stat, StatusChip, TableWrap,
  todayInZone, useAuth, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { daysBetween, downloadAttachment, FileTypeIcon, type Attachment } from './shared';
import './attachments.css';

type Source = 'vendor' | 'library' | 'files';
const SOURCE_LABEL: Record<Source, string> = { vendor: 'Vendor evidence', library: 'Evidence library', files: 'File on a record' };

interface FileRow extends Attachment { days_left: number; expired: boolean; record_label: string; record_type_label: string; record_route: string }
interface VendorRow { id: string; title: string; vendor_id: string; vendor_name: string; expires_on: string; days_left: number; expired: boolean; type_label: string | null }

interface Line {
  key: string; source: Source; title: string; to?: string; file?: FileRow;
  about: string | null; aboutTo?: string; expires: string; daysLeft: number;
}

const WINDOWS = [30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Next ${d} days` }));

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ExpiringEvidence({ defaultSource = '' }: { defaultSource?: Source | '' }) {
  const toast = useToast();
  const { can, areaOn } = useAuth();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState('90');
  const today = useMemo(() => todayInZone(), []);

  const offered: Source[] = [
    ...(areaOn('vendors') && can('vendors.view') && routePaths.includes('/evidence/:id') ? ['vendor' as const] : []),
    ...(areaOn('evidence') && can('evidence.view') && routePaths.includes('/evidence-library/:id') ? ['library' as const] : []),
    'files' as const,
  ];
  const asked = params.get('source') ?? defaultSource;
  const source: Source | '' = offered.includes(asked as Source) ? (asked as Source) : '';
  const wants = (s: Source) => offered.includes(s) && (!source || source === s);

  const vendor = useFetch<{ rows: VendorRow[] }>(wants('vendor') ? `/api/vendors/evidence-expiring?days=${days}` : null, { keepPrevious: true });
  const files = useFetch<{ rows: FileRow[] }>(wants('files') ? `/api/attachments/evidence-expiring?days=${days}` : null, { keepPrevious: true });
  const library = useFetch<ListResult>(wants('library')
    ? `/api/evidence-library${listQuery({ pageSize: 200, sort: 'valid_until', dir: 'asc', filters: { 'valid_until.lt': addDays(today, Number(days) + 1) } })}` : null, { keepPrevious: true });
  const used = [...(wants('vendor') ? [vendor] : []), ...(wants('files') ? [files] : []), ...(wants('library') ? [library] : [])];
  const error = used.find((s) => s.error)?.error;
  const ready = used.every((s) => s.data);
  const loading = used.some((s) => s.loading);

  const lines: Line[] = ready ? [
    ...(wants('vendor') ? (vendor.data?.rows ?? []).map((r): Line => ({
      key: `v-${r.id}`, source: 'vendor', title: r.title, to: `/evidence/${r.id}`, about: r.vendor_name, aboutTo: `/vendors/${r.vendor_id}?tab=evidence`,
      expires: r.expires_on, daysLeft: r.days_left,
    })) : []),
    ...(wants('library') ? (library.data?.rows ?? []).map((r): Line => ({
      key: `l-${r.id}`, source: 'library', title: `${r.ref ? `${r.ref} ` : ''}${String(r.title ?? '')}`, to: `/evidence-library/${r.id}`,
      about: r._display?.owner_id ? `Owner: ${r._display.owner_id}` : null, expires: String(r.valid_until).slice(0, 10), daysLeft: daysBetween(today, String(r.valid_until).slice(0, 10)),
    })) : []),
    ...(wants('files') ? (files.data?.rows ?? []).map((r): Line => ({
      key: `f-${r.id}`, source: 'files', title: r.file_name, file: r, about: `${r.record_type_label}: ${r.record_label}`, aboutTo: `${r.record_route}?tab=attachments`,
      expires: String(r.expires_on), daysLeft: r.days_left,
    })) : []),
  ].sort((a, b) => a.expires.localeCompare(b.expires) || a.title.localeCompare(b.title)) : [];

  const expired = lines.filter((l) => l.daysLeft < 0).length;
  const download = (row: FileRow) => { downloadAttachment(row).catch((err) => toast.error(errorMessage(err))); };
  const pickSource = (v: string | null) => setParams((old) => {
    const next = new URLSearchParams(old);
    if (v) next.set('source', v); else next.delete('source');
    return next;
  }, { replace: true });

  let body;
  if (error) body = <ErrorState title="Expiring evidence could not be loaded" error={error} onRetry={() => used.forEach((s) => s.reload())} />;
  else if (!ready) body = <Loading lines={6} label="Loading expiring evidence" />;
  else if (!lines.length) {
    body = <EmptyState icon="check-square" title="Nothing is expiring" message={`No evidence you can see has expired or runs out in the next ${days} days.`} />;
  } else {
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Already expired" value={expired} color={expired ? 'red' : 'green'} />
          <Stat label={`Expiring in ${days} days`} value={lines.length - expired} color="amber" />
        </div>
        <TableWrap label="Evidence that has expired or is about to, soonest first" className={cx(loading && 'table-loading')}>
          <table className="table">
            <caption className="sr-only">Evidence that has expired or is about to, soonest first</caption>
            <thead>
              <tr>
                <th scope="col">Evidence</th>
                <th scope="col">Source</th>
                <th scope="col">About</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    {l.file ? (
                      <span className="att-file-cell">
                        <FileTypeIcon group={l.file.type_group} />
                        <button type="button" className="att-name" onClick={() => download(l.file!)} title={`Download ${l.title}`}>{l.title}</button>
                      </span>
                    ) : <Link to={l.to!}>{l.title}</Link>}
                  </td>
                  <td>{SOURCE_LABEL[l.source]}</td>
                  <td>{l.about ? (l.aboutTo ? <Link to={l.aboutTo}>{l.about}</Link> : l.about) : <span className="muted">–</span>}</td>
                  <td>{formatDate(l.expires)}</td>
                  <td>
                    <StatusChip color={l.daysLeft < 0 ? 'red' : l.daysLeft <= 30 ? 'orange' : 'amber'}
                      label={l.daysLeft < 0 ? `Expired ${-l.daysLeft} ${l.daysLeft === -1 ? 'day' : 'days'} ago` : l.daysLeft === 0 ? 'Expires today' : `Expires in ${l.daysLeft} ${l.daysLeft === 1 ? 'day' : 'days'}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader title="Expiring evidence"
        subtitle={`Evidence that has run out or soon will: ${[offered.includes('vendor') && 'vendor evidence', offered.includes('library') && 'the evidence library', 'files attached to records as evidence'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')}. Collect a current copy and record it where the old one was.`} />
      <Card>
        <div className="att-toolbar">
          {offered.length > 1 && (
            <Select label="Source" options={[{ value: '', label: 'Every source' }, ...offered.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))]}
              value={source} onChange={pickSource} />
          )}
          <Select label="Show evidence expiring in" required options={WINDOWS} value={days} onChange={(v) => setDays(v || '90')} />
        </div>
        {body}
      </Card>
    </div>
  );
}
