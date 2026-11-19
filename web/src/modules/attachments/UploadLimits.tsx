// File settings > Uploads: the size limit and the allowed types.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, TextArea, useFetch, useToast } from '../../core';
import type { FileConfig } from './shared';

export function UploadLimits() {
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
      toast.success('Upload limits saved.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading upload limits" />;
  return (
    <Card title="Upload limits">
      <form className="form" onSubmit={submit}>
        <p className="att-facts">They apply to new uploads; files already attached are not affected.</p>
        <NumberField
          label="Largest file (MB)" required min={1} max={2048} step={1} value={maxMb} onChange={setMaxMb} error={errors.maxMb}
          hint="Each file may be up to this size. From 1 to 2048."
        />
        <TextArea
          label="Allowed file types" required rows={3} value={types} onChange={setTypes} error={errors.allowedExtensions}
          hint="Extensions separated by commas, for example: pdf, docx, png. A file is refused when its content does not match its extension. Programs and scripts can never be allowed."
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={saving}>Save upload limits</Button>
        </div>
      </form>
    </Card>
  );
}
