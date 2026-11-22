// Administration > Email > Delivery log: every message the application tried to send.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, formatDateTime, Loading, qs, relativeTime, Select, StatusChip, TableWrap, useFetch } from '../../core';
import type { ColorName } from '../../core';

interface LogRow {
  id: string;
  created_at: string;
  job_id: string | null;
  template: string | null;
  purpose: string;
  to_address: string;
  subject: string;
  status: 'queued' | 'sent' | 'failed' | 'dead' | 'skipped';
  attempts: number;
  error: string | null;
  sent_at: string | null;
}

export const MAIL_STATUS: Record<LogRow['status'], { color: ColorName; label: string }> = {
  queued: { color: 'blue', label: 'Waiting' },
  sent: { color: 'green', label: 'Sent' },
  failed: { color: 'amber', label: 'Failed, will retry' },
  dead: { color: 'red', label: 'Gave up' },
  skipped: { color: 'gray', label: 'Not sent' },
};
const PURPOSES: Record<string, string> = {
  test: 'Test', notification: 'Notification', digest: 'Daily summary', setup_link: 'Set-up link', reset_link: 'Reset link',
};

export function MailLog() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload, loading } = useFetch<{ rows: LogRow[]; total: number; page: number; pageSize: number }>(
    `/api/admin/mail/log${qs({ status, page, pageSize: 25 })}`,
  );

  const toolbar = (
    <div className="ml-toolbar">
      <Select
        label="Status" value={status} placeholder="Any status"
        options={[{ value: '', label: 'Any status' }, ...Object.entries(MAIL_STATUS).map(([value, s]) => ({ value, label: s.label, color: s.color }))]}
        onChange={(v) => { setStatus(v); setPage(1); }}
      />
      <Button icon="refresh" loading={loading} onClick={reload}>Refresh</Button>
    </div>
  );

  if (error) return <ErrorState title="The delivery log could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={8} label="Loading the delivery log" />;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="stack">
      {toolbar}
      <Card flush>
        {data.total === 0 ? (
          <EmptyState icon="message" title={status ? 'Nothing with this status' : 'Nothing sent yet'} message="Each message the application tries to send is listed here, with what happened to it." />
        ) : (
          <TableWrap label="Messages sent">
            <table className="table ml-table">
              <thead>
                <tr><th scope="col">When</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Kind</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ml-small ml-nowrap"><span title={formatDateTime(r.created_at)}>{relativeTime(r.created_at)}</span></td>
                    <td className="ml-wrap ml-small">{r.to_address}</td>
                    <td className="ml-wrap">
                      {r.subject || <span className="muted">(written when sent)</span>}
                      {r.error && <div className="ml-error">{r.error}</div>}
                    </td>
                    <td className="ml-small">{PURPOSES[r.purpose] ?? r.purpose}</td>
                    <td>
                      <StatusChip color={MAIL_STATUS[r.status]?.color ?? 'gray'} label={MAIL_STATUS[r.status]?.label ?? r.status} />
                      <div className="muted ml-small">
                        {r.attempts} {r.attempts === 1 ? 'attempt' : 'attempts'}
                        {r.job_id && <> · <Link to={`/admin/jobs?job=${r.job_id}`}>job</Link></>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {data.total > data.pageSize && (
        <div className="ntf-pager">
          <span className="muted">Page {data.page} of {pages} · {data.total} messages</span>
          <Button size="sm" icon="chevron-left" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <Button size="sm" disabled={data.page >= pages} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}
