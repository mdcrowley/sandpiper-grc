// File settings > Reading scans (E46-56): the languages scanned PDFs are read in by OCR, chosen from
// the language data installed with the application (English and Spanish) or in GRC_OCR_LANG_DIR.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, Button, Card, Checkbox, errorMessage, ErrorState, Loading, Notice, useFetch, useToast } from '../../core';

interface OcrOverview {
  switched_off: boolean; engine_installed: boolean; ready: boolean; reason: string | null; folder: 'bundled' | 'custom';
  languages: { code: string; name: string }[]; chosen: string[]; source: 'setting' | 'environment' | 'default';
  max_languages: number; max_pages: number; scans_not_read: number; scans_read: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OcrSettings() {
  const toast = useToast();
  const { data, error, reload } = useFetch<OcrOverview>('/api/attachments/admin/ocr');
  const [chosen, setChosen] = useState<string[]>([]);
  const [reread, setReread] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setChosen(data.chosen.filter((c) => data.languages.some((l) => l.code === c))); }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the OCR languages" />;

  const toggle = (code: string, on: boolean) => setChosen((c) => (on ? [...c, code] : c.filter((x) => x !== code)));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldError(undefined);
    try {
      const r = await api.put<OcrOverview & { requeued: number }>('/api/attachments/admin/ocr', { languages: chosen, reread });
      toast.success(r.requeued
        ? `Languages saved. ${plural(r.requeued, 'scanned file is', 'scanned files are')} read again in the background.`
        : 'Languages saved. New scans are read in them.');
      setReread(false);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields.languages) setFieldError(err.fields.languages);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const off = data.switched_off || !data.engine_installed;
  return (
    <div className="stack">
      {data.switched_off && <Notice tone="neutral" title="Reading scans is switched off">This installation is set not to read scans (GRC_OCR=off): a scanned PDF is found by its title and number only.</Notice>}
      {!data.switched_off && !data.engine_installed && <Notice tone="warning" title="The OCR engine is not installed">Scans are found by their title and number only until the tesseract.js package is installed.</Notice>}
      {!off && !data.ready && data.reason && <Notice tone="warning" title="Scans cannot be read">{data.reason}.</Notice>}
      <Card title="Languages of scanned documents">
        <form className="form" onSubmit={save}>
          <p className="att-facts">
            A PDF with no text layer (a scan) is read by optical character recognition (OCR), on this server, so that search finds it by its words.
            Choose the languages your scanned documents are written in: each extra language makes reading slower, so choose only those you need
            (at most {data.max_languages}). The first {data.max_pages} pages of each scan are read.
          </p>
          <fieldset className="att-fieldset" aria-describedby="att-ocr-hint">
            <legend>Read scans in</legend>
            {data.languages.length === 0
              ? <p className="muted">There is no language data in the language folder.</p>
              : data.languages.map((l) => (
                <Checkbox key={l.code} label={l.name} checked={chosen.includes(l.code)} onChange={(on) => toggle(l.code, on)} disabled={off} />
              ))}
            <p id="att-ocr-hint" className="att-facts">
              {data.folder === 'bundled'
                ? 'The application comes with English and Spanish. Other languages are added by the person who runs the server (GRC_OCR_LANG_DIR); nothing is downloaded.'
                : 'These are the languages in the folder set by the person who runs the server (GRC_OCR_LANG_DIR); nothing is downloaded.'}
              {data.source === 'environment' ? ' Until you save a choice, the server setting GRC_OCR_LANGS applies.' : ''}
            </p>
            {fieldError && <p className="field-error" role="alert">{fieldError}</p>}
          </fieldset>
          <Checkbox label="Also read again the scans already read by OCR" checked={reread} onChange={setReread} disabled={off || data.scans_read === 0}
            hint={`${plural(data.scans_read, 'scan was', 'scans were')} read by OCR before; ${plural(data.scans_not_read, 'scan is', 'scans are')} not read yet and ${data.scans_not_read === 1 ? 'is' : 'are'} read again when you save.`} />
          <div className="row">
            <Button type="submit" loading={saving} disabled={off || chosen.length === 0}>Save languages</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
