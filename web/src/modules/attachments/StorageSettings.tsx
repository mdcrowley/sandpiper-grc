// File settings > Storage: the local disk (default) or an S3-compatible object store, and the
// check that compares stored files with the records of them.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, errorMessage, formatDateTime, Select, TableWrap, TextField, useToast,
} from '../../core';
import type { FilesOverview, S3Settings } from './adminTypes';
import { STORE_LABELS } from './adminTypes';
import { MoveFilesCard } from './BackgroundWork';
import { usePasswordConfirm } from './confirm';
import { formatBytes } from './shared';

interface CheckReport {
  checkedAt: string;
  rows: number;
  stored: number;
  missing: { id: string; file_name: string; driver: string }[];
  missingCount: number;
  unreferenced: { driver: string; key: string; size: number }[];
  unreferencedCount: number;
  unavailable: { driver: string; reason: string }[];
}

type Form = S3Settings & { secretAccessKey: string };

export function StorageSettings({ overview, onSaved }: { overview: FilesOverview; onSaved: () => void }) {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const [driver, setDriver] = useState(overview.storage.driver);
  const [form, setForm] = useState<Form>({ ...overview.storage.s3, secretAccessKey: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);

  useEffect(() => {
    setDriver(overview.storage.driver);
    setForm({ ...overview.storage.s3, secretAccessKey: '' });
  }, [overview.storage]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const s3Body = () => {
    const { secretSet: _s, ...rest } = form;
    return rest;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await confirm.run(() => api.patch('/api/attachments/admin/storage', { driver, s3: s3Body() }));
      toast.success(driver === 's3' ? 'New files now go to the object store.' : 'New files now go to the local disk.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setErrors({});
    try {
      setTest(await confirm.run(() => api.post<{ ok: boolean; message: string }>('/api/attachments/admin/storage/test', { s3: s3Body() })));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setReport(await api.post<CheckReport>('/api/attachments/admin/check', {}));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const s3 = driver === 's3';
  return (
    <div className="stack">
      {confirm.dialog}
      <Card title="Where files are kept">
        <form className="form" onSubmit={save}>
          <Select
            label="Store new files on" required value={driver} onChange={(v) => setDriver(v as 'disk' | 's3')}
            options={[{ value: 'disk', label: 'The local disk (in the data folder)' }, { value: 's3', label: 'An S3-compatible object store' }]}
            hint="Files already stored stay where they are and remain readable. To move them, save this choice, then use Move stored files below."
          />
          {overview.s3Problem && <div className="notice notice-warn" role="status">The object store cannot be used: {overview.s3Problem}</div>}
          <fieldset className="att-fieldset">
            <legend>Object store connection</legend>
            <p className="att-facts">An outbound connection: used only when the object store is chosen above (and by backups sent there). The settings are tested before they are saved.</p>
            <div className="form-grid">
              <TextField label="Endpoint" required={s3} value={form.endpoint} onChange={(v) => set('endpoint', v)} error={errors.endpoint} placeholder="https://s3.example.net" hint="The service address, without the bucket." />
              <TextField label="Region" required={s3} value={form.region} onChange={(v) => set('region', v)} error={errors.region} />
              <TextField label="Bucket" required={s3} value={form.bucket} onChange={(v) => set('bucket', v)} error={errors.bucket} />
              <TextField label="Prefix" value={form.prefix} onChange={(v) => set('prefix', v)} error={errors.prefix} placeholder="grc/" hint="Optional folder inside the bucket." />
              <Checkbox
                className="form-cell-wide" label="Path-style addresses (endpoint/bucket/file)" checked={form.pathStyle} onChange={(v) => set('pathStyle', v)}
                hint="Most self-hosted stores need this. Clear it for addresses of the form bucket.endpoint/file."
              />
              <Select
                label="Server-side encryption" required value={form.sse} onChange={(v) => set('sse', v as S3Settings['sse'])} error={errors.sse}
                options={[{ value: 'none', label: 'Store default' }, { value: 'AES256', label: 'AES256 (keys managed by the store)' }, { value: 'aws:kms', label: 'aws:kms (a key management service key)' }]}
              />
              {form.sse === 'aws:kms'
                ? <TextField label="Key ID" value={form.kmsKeyId} onChange={(v) => set('kmsKeyId', v)} error={errors.kmsKeyId} hint="Leave empty for the store's default key." />
                : <span aria-hidden="true" />}
              <Select
                className="form-cell-wide" label="Credentials" required value={form.credentials} onChange={(v) => set('credentials', v as S3Settings['credentials'])} error={errors.credentials}
                options={[
                  { value: 'settings', label: 'Entered here (the secret is stored encrypted)' },
                  { value: 'file', label: 'A credentials file on the server' },
                  { value: 'environment', label: 'The server\'s environment (GRC_S3_ACCESS_KEY_ID, GRC_S3_SECRET_ACCESS_KEY)' },
                ]}
              />
              {form.credentials === 'settings' && (
                <>
                  <TextField label="Access key" required={s3} value={form.accessKeyId} onChange={(v) => set('accessKeyId', v)} error={errors.accessKeyId} autoComplete="off" />
                  <TextField
                    label="Secret key" type="password" required={s3 && !form.secretSet} value={form.secretAccessKey} onChange={(v) => set('secretAccessKey', v)}
                    error={errors.secretAccessKey} autoComplete="new-password"
                    hint={form.secretSet ? 'A secret is saved. Leave this empty to keep it.' : 'Encrypted with the application\'s secret key before it is stored; never shown again.'}
                  />
                </>
              )}
              {form.credentials === 'file' && (
                <TextField
                  className="form-cell-wide" label="Credentials file" required={s3} value={form.credentialsFile} onChange={(v) => set('credentialsFile', v)} error={errors.credentialsFile}
                  hint='Full path on the server of a JSON file: { "accessKeyId": "...", "secretAccessKey": "..." }. Keep it outside the data folder.'
                />
              )}
            </div>
          </fieldset>
          {test && <div className={test.ok ? 'notice notice-success' : 'notice notice-warn'} role="status">{test.message}</div>}
          <div className="form-actions">
            <Button onClick={runTest} loading={testing}>Test connection</Button>
            <Button type="submit" variant="primary" loading={saving}>Save storage settings</Button>
          </div>
        </form>
      </Card>
      <MoveFilesCard overview={overview} onDone={onSaved} />
      <Card title="Storage check">
        <div className="stack">
          <p className="att-facts">Compares every stored file with the records of attached files: files missing from storage, and stored files that no record refers to. Nothing is changed.</p>
          {report && (
            <div className="stack">
              <div className={report.missingCount || report.unreferencedCount || report.unavailable.length ? 'notice notice-warn' : 'notice notice-success'} role="status">
                Checked {formatDateTime(report.checkedAt)}: {report.rows} file{report.rows === 1 ? '' : 's'} in use or removed, {report.stored} stored.{' '}
                {report.missingCount} missing from storage; {report.unreferencedCount} stored with no record.
                {report.unavailable.map((u) => ` ${STORE_LABELS[u.driver] ?? u.driver} could not be checked: ${u.reason}`).join('')}
              </div>
              {report.missing.length > 0 && (
                <TableWrap label="Files missing from storage">
                  <table className="table">
                    <caption className="sr-only">Files missing from storage</caption>
                    <thead><tr><th>Missing file</th><th>Store</th></tr></thead>
                    <tbody>{report.missing.map((m) => <tr key={m.id}><td>{m.file_name}</td><td>{STORE_LABELS[m.driver] ?? m.driver}</td></tr>)}</tbody>
                  </table>
                </TableWrap>
              )}
              {report.unreferenced.length > 0 && (
                <TableWrap label="Stored files with no record">
                  <table className="table">
                    <caption className="sr-only">Stored files with no record</caption>
                    <thead><tr><th>Stored with no record</th><th>Store</th><th className="num">Size</th></tr></thead>
                    <tbody>{report.unreferenced.map((u) => <tr key={`${u.driver}:${u.key}`}><td className="att-hash">{u.key}</td><td>{STORE_LABELS[u.driver] ?? u.driver}</td><td className="num">{formatBytes(u.size)}</td></tr>)}</tbody>
                  </table>
                </TableWrap>
              )}
            </div>
          )}
          <div className="row"><Button onClick={runCheck} loading={checking}>Check storage</Button></div>
        </div>
      </Card>
    </div>
  );
}
