// File settings > Removed files: how long removed files are kept, and putting one back.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, NumberField,
  StatusChip, useFetch, useToast,
} from '../../core';
import type { RemovedFile } from './adminTypes';
import { usePasswordConfirm } from './confirm';
import { FileTypeIcon, formatBytes } from './shared';

const REASONS: Record<RemovedFile['removed_reason'], { label: string; color: 'gray' | 'amber' | 'red' }> = {
  removed: { label: 'Removed by a person', color: 'gray' },
  record_gone: { label: 'Record deleted', color: 'amber' },
  infected: { label: 'Malware found', color: 'red' },
};

export function RemovedFiles({ purgeDays, onChanged }: { purgeDays: number; onChanged: () => void }) {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const { data, error, reload } = useFetch<{ purgeDays: number; rows: RemovedFile[] }>('/api/attachments/admin/removed');
  const [days, setDays] = useState<number | null>(purgeDays);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => { setDays(purgeDays); }, [purgeDays]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldError(undefined);
    try {
      await confirm.run(() => api.patch('/api/attachments/admin/purge', { purgeDays: days }));
      toast.success(days ? `Removed files are now kept for ${days} days.` : 'Removed files are now kept until you change this.');
      reload();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.fields.purgeDays) setFieldError(err.fields.purgeDays);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const purgeNow = async () => {
    setPurging(true);
    try {
      const r = await confirm.run(() => api.post<{ purged: number; bytes: number; failed: number }>('/api/attachments/admin/purge/run', {}));
      toast.success(r.purged ? `Purged ${r.purged} file${r.purged === 1 ? '' : 's'} (${formatBytes(r.bytes)}).` : 'Nothing is past the period yet.');
      if (r.failed) toast.error(`${r.failed} file${r.failed === 1 ? '' : 's'} could not be deleted from storage; they will be tried again tomorrow.`);
      reload();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPurging(false);
    }
  };

  const restore = async (f: RemovedFile) => {
    setRestoring(f.id);
    try {
      await api.post(`/api/attachments/admin/removed/${f.id}/restore`, {});
      toast.success(`"${f.file_name}" is back on ${f.record_label}.`);
      reload();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="stack">
      {confirm.dialog}
      <Card title="How long removed files are kept">
        <form className="form" onSubmit={save}>
          <p className="att-facts">
            A removed file stays in storage for this many days, so it can be put back, and is then purged by the daily job. Records themselves are never
            deleted by this: a record past its retention period goes to the retention review, and its files follow only once it is deleted there.
          </p>
          <div className="att-inline-form">
            <NumberField label="Keep removed files for (days)" required min={0} max={3650} value={days} onChange={setDays} error={fieldError} hint="0 keeps them indefinitely." />
            <Button type="submit" variant="primary" loading={saving}>Save</Button>
            <Button onClick={purgeNow} loading={purging} disabled={!purgeDays}>Purge now</Button>
          </div>
        </form>
      </Card>
      <Card title="Removed files" flush>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} label="Loading removed files" /> : data.rows.length === 0 ? (
          <EmptyState icon="trash" title="No removed files waiting" message="Files that people remove are listed here until they are purged." />
        ) : (
          <div className="table-wrap">
            <table className="table att-removed">
              <caption className="sr-only">Removed files that have not been purged</caption>
              <thead>
                <tr><th>File</th><th>Record</th><th>Why</th><th>Removed</th><th>Purged on</th><th className="num">Size</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.rows.map((f) => (
                  <tr key={f.id}>
                    <td><span className="att-file-cell"><FileTypeIcon group={f.type_group} /><span>{f.file_name}</span></span></td>
                    <td>
                      {f.record_route ? <Link to={f.record_route}>{f.record_label}</Link> : <span>{f.record_label}</span>}
                      <div className="att-facts">{f.record_type_label}{f.record_deleted ? ' (deleted)' : ''}</div>
                    </td>
                    <td><StatusChip color={REASONS[f.removed_reason]?.color ?? 'gray'} label={REASONS[f.removed_reason]?.label ?? f.removed_reason} /></td>
                    <td title={formatDateTime(f.removed_at)}>{formatDate(f.removed_at)}</td>
                    <td>{f.purge_on ? formatDate(f.purge_on) : 'Kept'}</td>
                    <td className="num">{formatBytes(f.size_bytes)}</td>
                    <td>
                      {f.can_restore
                        ? <Button size="sm" loading={restoring === f.id} onClick={() => restore(f)}>Put back</Button>
                        : <span className="att-facts">Record gone</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
