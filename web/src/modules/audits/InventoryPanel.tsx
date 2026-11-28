// Inspections and defects on a vehicle, site or asset page (wave 26, E46, contract C2): whether the
// record is out of service, its open defects (with "New defect") and its inspections, newest first.
// A tab on the vehicle page and a section on the site and asset pages; left out while the audits
// area is switched off, and empty for people who may not view inspections.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, Notice, StatusChip, TableWrap, useAuth, useFetch } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import { NewDefectDialog } from './Defects';

interface History {
  out_of_service: boolean;
  record: { status: string | null };
  counts: { open: number; out_of_service: number; to_verify: number; deferral_overdue: number; overdue: number; missed: number; next_due: string | null };
  inspections: { id: string; ref: string; title: string; due_on: string | null; performed_on: string | null; status: string; result: string | null; score_pct: number | null }[];
  defects: { id: string; ref: string; title: string; severity: string; status: string; out_of_service: boolean; found_on: string | null; deferred_until: string | null; work_order_ref: string | null }[];
  can_create: boolean;
}

const OPEN = ['open', 'deferred', 'repair_ordered', 'repaired'];

function HistoryPanel({ recordType, recordId }: InventoryPanelProps) {
  const { can } = useAuth();
  const allowed = can('audits.view');
  const { data, error, reload } = useFetch<History>(allowed ? `/api/inspection-history/${recordType}/${recordId}` : null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!allowed) return null;
  const noun = recordType === 'vehicle' ? 'vehicle' : recordType === 'site' ? 'site' : 'asset';
  const body = error ? <ErrorState error={error} onRetry={reload} />
    : !data ? <Loading lines={4} label="Loading inspections and defects" />
    : (() => {
      const defects = showAll ? data.defects : data.defects.filter((d) => OPEN.includes(d.status));
      return (
        <div className="stack">
          {data.out_of_service && (
            <Notice tone="warning" title="Out of service">
              {data.counts.out_of_service
                ? `${data.counts.out_of_service} open ${data.counts.out_of_service === 1 ? 'defect keeps' : 'defects keep'} this ${noun} out of service until repaired and verified.`
                : `This ${noun} is marked out of service, and no open defect keeps it so: return it to service on its record when it is fit.`}
            </Notice>
          )}
          <p className="muted">
            {data.counts.open} open {data.counts.open === 1 ? 'defect' : 'defects'}, {data.counts.to_verify} repaired and waiting for verification
            {data.counts.deferral_overdue ? `, ${data.counts.deferral_overdue} past the date to repair by` : ''}.
            {' '}{data.counts.overdue ? `${data.counts.overdue} ${data.counts.overdue === 1 ? 'inspection' : 'inspections'} overdue. ` : ''}
            {data.counts.missed ? `${data.counts.missed} missed. ` : ''}
            {data.counts.next_due ? `Next inspection due ${formatDate(data.counts.next_due)}.` : 'No inspection scheduled.'}
          </p>
          <div className="au-history-head">
            <h3 className="au-subhead">Defects</h3>
            <span>
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Open defects only' : 'Show all defects'}</Button>
              {data.can_create && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>New defect</Button>}
            </span>
          </div>
          {defects.length === 0 ? <p className="muted">{showAll ? 'No defects recorded.' : 'No open defects.'}</p> : (
            <TableWrap label={`Defects on this ${noun}`} fit>
              <table className="table">
                <caption className="sr-only">Defects on this {noun}</caption>
                <thead><tr><th scope="col">Defect</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col" data-priority="2">Found</th><th scope="col" data-priority="3">Repair by</th></tr></thead>
                <tbody>
                  {defects.map((d) => (
                    <tr key={d.id}>
                      <td><Link className="row-title" to={`/inspections/defects/${d.id}`}><span className="ref">{d.ref}</span> {d.title}</Link>{d.out_of_service && OPEN.slice(0, 3).includes(d.status) ? <> <StatusChip color="red" label="Out of service" /></> : null}</td>
                      <td><LookupChip list="defect_severity" value={d.severity} /></td>
                      <td><LookupChip list="defect_status" value={d.status} /></td>
                      <td data-priority="2">{formatDate(d.found_on)}</td>
                      <td data-priority="3">{d.deferred_until ? formatDate(d.deferred_until) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <h3 className="au-subhead">Inspections</h3>
          {data.inspections.length === 0 ? <EmptyState icon="check-square" title="No inspections" message={`Inspections of this ${noun} are listed here once one is scheduled or carried out.`} /> : (
            <TableWrap label={`Inspections of this ${noun}`} fit>
              <table className="table">
                <caption className="sr-only">Inspections of this {noun}</caption>
                <thead><tr><th scope="col">Inspection</th><th scope="col">Due</th><th scope="col" data-priority="2">Performed</th><th scope="col">Status</th><th scope="col" data-priority="2">Result</th></tr></thead>
                <tbody>
                  {data.inspections.map((i) => (
                    <tr key={i.id}>
                      <td><Link className="row-title" to={`/inspections/${i.id}`}><span className="ref">{i.ref}</span> {i.title}</Link></td>
                      <td>{formatDate(i.due_on)}</td>
                      <td data-priority="2">{i.performed_on ? formatDate(i.performed_on) : '—'}</td>
                      <td><LookupChip list="inspection_status" value={i.status} /></td>
                      <td data-priority="2">{i.result ? <LookupChip list="inspection_result" value={i.result} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
      );
    })();
  return (
    <Card title="Inspections and defects">
      {body}
      {adding && <NewDefectDialog open onClose={() => setAdding(false)} initial={{ target_type: recordType, target_id: recordId }} onCreated={() => reload()} />}
    </Card>
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'inspections', label: 'Inspections and defects', area: 'audits', appliesTo: ['vehicle', 'site', 'asset'], Panel: HistoryPanel },
];
