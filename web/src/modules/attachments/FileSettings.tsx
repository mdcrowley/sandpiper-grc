// Administrator settings for attached files: the size limit and the allowed types.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, TextArea, useFetch, useToast,
} from '../../core';
import type { FileConfig } from './shared';
import './attachments.css';

export function FileSettings() {
  const toast = useToast();
  const { data, error, reload } = useFetch<FileConfig>('/api/attachments/config');
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const [types, setTypes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMaxMb(Math.round(data.maxBytes / (1024 * 1024)));
    setTypes(data.allowedExtensions.join(', '));
  }, [data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.patch('/api/attachments/settings', { maxMb, allowedExtensions: types });
      toast.success('File settings saved.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack att-settings">
      <PageHeader
        title="File settings"
        subtitle="Limits for files attached to records. They apply to new uploads; files already attached are not affected."
        breadcrumbs={[{ label: 'Administration' }, { label: 'File settings' }]}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={5} label="Loading file settings" /> : (
        <Card title="Attachments">
          <form className="form" onSubmit={submit}>
            <NumberField
              label="Largest file (MB)" required min={1} max={2048} step={1} value={maxMb} onChange={setMaxMb} error={errors.maxMb}
              hint="Each file may be up to this size. From 1 to 2048."
            />
            <TextArea
              label="Allowed file types" required rows={3} value={types} onChange={setTypes} error={errors.allowedExtensions}
              hint="Extensions separated by commas, for example: pdf, docx, png. A file is refused when its content does not match its extension. Programs and scripts can never be allowed."
            />
            <p className="att-facts">
              Malware scanning: {data.scanner === 'none'
                ? 'no scanner is installed, so files are accepted without a malware scan and marked "Not scanned".'
                : `every file is checked by "${data.scanner}" before it is accepted.`}
            </p>
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={saving}>Save settings</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
