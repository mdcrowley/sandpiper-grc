// Training records as a filterable list. The overview's charts and tiles drill into this page.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatDate, Loading, PageHeader, qs, Select, TableWrap, TextField, useAuth, useDebounced, useFetch,
} from '../../core';
import type { ListResult, Row } from '../../core';
import { RecordStatusChip, ResultCell, SOURCE, STATUS, WhenCell } from './shared';
import type { Audiences, TrainingRecord } from './shared';

interface RecordList { today: string; rows: TrainingRecord[]; total: number }

function downloadCsv(rows: TrainingRecord[]) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Person', 'Email', 'Department', 'Course', 'Status', 'Assigned on', 'Due on', 'Completed on', 'Score', 'Result', 'Evidence note', 'Source'];
  const lines = rows.map((r) => [
    r.person, r.email, r.department, r.course_title, STATUS[r.status].label, r.assigned_on, r.due_on, r.completed_on, r.score, r.result,
    r.evidence_note, SOURCE[r.source],
  ].map(cell).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'training-records.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TrainingRecords() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const q = useDebounced(get('q'), 300);
  const overdueAt = get('overdue_at');

  const url = `/api/training/records${qs({
    course_id: get('course_id'), department: get('department'), status: get('status'), overdue_at: overdueAt,
    active: get('active'), scope: get('scope'), q,
  })}`;
  const { data, error, reload } = useFetch<RecordList>(url);
  const courses = useFetch<ListResult<Row>>('/api/courses?pageSize=500&sort=title');
  const audiences = useFetch<Audiences>('/api/training/audiences');

  const courseOptions = useMemo(() => (courses.data?.rows ?? []).map((c) => ({ value: c.id, label: c.title })), [courses.data]);
  const departmentOptions = useMemo(
    () => [...(audiences.data?.department_names ?? []).map((n) => ({ value: n, label: n })), { value: 'none', label: 'No department' }],
    [audiences.data],
  );
  const filtered = ['course_id', 'department', 'status', 'overdue_at', 'q', 'scope'].some((k) => get(k));

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading training records" />;
  else if (!data.rows.length) {
    body = (
      <EmptyState
        icon="graduation" title={filtered ? 'No records match' : 'No training records yet'}
        message={filtered ? 'Change or clear the filters to see more.' : 'Records appear when a course is assigned or a completion is recorded.'}
        action={filtered ? <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button> : undefined}
      />
    );
  } else {
    body = (
      <TableWrap label="Training records" className="trn-tw">
        <table className="table">
          <caption className="sr-only">Training records</caption>
          <thead>
            <tr>
              <th scope="col">Person</th><th scope="col">Department</th><th scope="col">Course</th><th scope="col">Status</th>
              <th scope="col">Due or completed</th><th scope="col">Result</th><th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="row-title">{r.person}</span>
                  {!r.has_account && <span className="muted trn-tag">no account</span>}
                </td>
                <td>{r.department ?? <span className="muted">—</span>}</td>
                <td><Link to={`/training/courses/${r.course_id}?tab=people`}>{r.course_title}</Link></td>
                <td><RecordStatusChip record={r} today={data.today} /></td>
                <td><WhenCell record={r} today={data.today} /></td>
                <td><ResultCell record={r} /></td>
                <td className="muted">{SOURCE[r.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Training records"
        breadcrumbs={[{ label: 'Training overview', to: '/training' }, { label: 'Records' }]}
        subtitle={overdueAt
          ? `Records that were overdue on ${formatDate(overdueAt)}.`
          : get('scope') === 'all' ? 'Every record, including earlier completions.' : 'The latest record for each person and course.'}
        actions={data?.rows.length && can('training.export') ? <Button icon="download" onClick={() => downloadCsv(data.rows)}>Export</Button> : undefined}
      />
      <div className="trn-filters">
        <TextField label="Search" type="search" placeholder="Person or course" value={get('q')} onChange={(v) => set('q', v)} />
        <Select label="Course" placeholder="All courses" value={get('course_id')} options={courseOptions} onChange={(v) => set('course_id', v)} />
        <Select label="Department" placeholder="All departments" value={get('department')} options={departmentOptions} onChange={(v) => set('department', v)} />
        <Select label="Status" placeholder="Any status" value={get('status')} onChange={(v) => set('status', v)}
          options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        <Select label="Show" value={get('scope') || 'latest'} onChange={(v) => set('scope', v === 'all' ? 'all' : '')}
          options={[{ value: 'latest', label: 'Latest per person' }, { value: 'all', label: 'Every record' }]} />
        {filtered && <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
      </div>
      <Card flush={!!data?.rows.length} title={data ? `${data.total} record${data.total === 1 ? '' : 's'}` : undefined}>{body}</Card>
    </div>
  );
}
