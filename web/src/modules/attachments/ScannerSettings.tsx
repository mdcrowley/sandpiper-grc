// File settings > Malware scanning: a ClamAV daemon reached over TCP, off until switched on.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, errorMessage, formatDateTime, NumberField, Select, Switch, TextField, useToast,
} from '../../core';
import type { FilesOverview, ScannerSettings as Settings } from './adminTypes';
import { RescanCard } from './BackgroundWork';
import { usePasswordConfirm } from './confirm';

interface TestResult { ok: boolean; engine?: string; signatures?: string | null; signatureDate?: string | null; message?: string }

export function ScannerSettings({ overview, onSaved }: { overview: FilesOverview; onSaved: () => void }) {
  const toast = useToast();
  const confirm = usePasswordConfirm();
  const [form, setForm] = useState<Settings>(overview.scanner);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => { setForm(overview.scanner); }, [overview.scanner]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await confirm.run(() => api.patch('/api/attachments/admin/scanner', form));
      toast.success(form.enabled ? 'Malware scanning is on: every new file is checked.' : 'Malware scanning settings saved.');
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
    try {
      setTest(await api.post<TestResult>('/api/attachments/admin/scanner/test', form));
    } catch (err) {
      setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const active = overview.activeScanner;
  return (
    <div className="stack">
      {confirm.dialog}
      <Card title="Malware scanning">
        <form className="form" onSubmit={save}>
          <p className="att-facts">
            {active === 'none'
              ? 'Scanning is off: files are accepted without a malware scan and marked "Not scanned".'
              : active === 'clamav'
                ? 'Scanning is on: every new file is sent to ClamAV and refused if malware is found.'
                : `Every new file is checked by "${active}" before it is accepted.`}
          </p>
          <Switch
            label="Scan every new file with ClamAV" checked={form.enabled} onChange={(v) => set('enabled', v)}
            hint="ClamAV's scanning service (clamd) must be running and listening on TCP. The file's content is sent to it, so run it on this machine or one you control."
          />
          <div className="form-grid">
            <TextField label="Scanner address" required value={form.host} onChange={(v) => set('host', v)} error={errors.host} hint="Host name or IP address. 127.0.0.1 is this machine." />
            <NumberField label="Port" required min={1} max={65535} value={form.port} onChange={(v) => set('port', v ?? 3310)} error={errors.port} hint="clamd's TCPSocket setting; usually 3310." />
            <NumberField label="Time limit (seconds)" required min={1} max={600} value={form.timeoutSeconds} onChange={(v) => set('timeoutSeconds', v ?? 60)} error={errors.timeoutSeconds} hint="For one file, from connecting to the verdict." />
            <NumberField label="Largest file to scan (MB)" required min={1} max={4096} value={form.maxMb} onChange={(v) => set('maxMb', v ?? 100)} error={errors.maxMb} hint="Keep clamd's StreamMaxLength at least this large." />
            <Select
              className="form-cell-wide" label="When the scanner cannot check a file" required value={form.whenUnavailable}
              onChange={(v) => set('whenUnavailable', v as Settings['whenUnavailable'])} error={errors.whenUnavailable}
              options={[
                { value: 'accept', label: 'Accept it as "Not scanned" and warn the uploader' },
                { value: 'refuse', label: 'Refuse it, and ask the uploader to try again later' },
              ]}
              hint="For example when clamd is stopped, busy or the file is over its limit. Either way the event is recorded in the audit log."
            />
          </div>
          {test && (
            <div className={test.ok ? 'notice notice-success' : 'notice notice-warn'} role="status">
              {test.ok
                ? <>Connected to {test.engine}. Signatures version {test.signatures ?? 'unknown'}{test.signatureDate ? `, dated ${formatDateTime(test.signatureDate)}` : ''}.</>
                : test.message}
            </div>
          )}
          <div className="form-actions">
            <Button onClick={runTest} loading={testing}>Test connection</Button>
            <Button type="submit" variant="primary" loading={saving}>Save scanning settings</Button>
          </div>
        </form>
      </Card>
      <RescanCard overview={overview} onDone={onSaved} />
    </div>
  );
}
