// A new version from a file (E43-06, E43-07): a Word document is converted to text, shown beside
// the conversion report and a preview, and may be corrected before it is saved as a draft; a PDF (or
// a file that cannot be converted, such as an old .doc) becomes a file version, kept as it is. The
// file as received is always kept as the version's original.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, Loading, Notice, PageHeader, ProgressBar, TextArea, TextField, useDebounced, useFetch,
  useRecord, useToast, useUnsavedChanges,
} from '../../../core';
import { PolicyBody } from '../shared';
import { recordPath, reportWarnings, type ConversionReport, type DocVersion } from './types';
import { extensionOf, uploadInParts, type Upload } from './upload';

interface Converted { markdown: string; report: ConversionReport & { dropped?: string[]; suggested?: Record<string, string>; note?: string }; images?: { name: string }[] }

/** Puts the stored images' ids in place of the preview's `attachment:pending-N` markers. */
export function placeImages(markdown: string, ids: string[]): string {
  return markdown.replace(/attachment:pending-(\d+)/g, (whole, n: string) => {
    const id = ids[Number(n) - 1];
    return id ? `attachment:${id}` : whole;
  });
}

/** The conversion report: what was kept, left out or needs a look. */
export function ConversionReportCard({ report, imageCount }: { report: Converted['report']; imageCount: number }) {
  const warnings = reportWarnings(report);
  const suggested = Object.entries(report.suggested ?? {}).filter(([, v]) => v);
  const LABEL: Record<string, string> = { version_label: 'Revision', effective_on: 'Effective date', doc_number: 'Document number' };
  return (
    <Card title="Conversion report">
      <div className="stack">
        <p>
          {report.status === 'file_only' ? 'Kept as a file, not converted.' : 'Converted to text.'}
          {imageCount ? ` ${imageCount} ${imageCount === 1 ? 'picture is' : 'pictures are'} kept with the document.` : ''}
          {report.comments ? ` ${report.comments} ${report.comments === 1 ? 'comment was' : 'comments were'} left out.` : ''}
        </p>
        {warnings.length > 0 ? (
          <ul className="doc-warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        ) : report.status !== 'file_only' ? <p className="muted">Nothing needed attention. Compare the text with the original before sending it for review.</p> : null}
        {suggested.length > 0 && (
          <p className="muted doc-small">
            Found in the page headers and footers: {suggested.map(([k, v]) => `${LABEL[k] ?? k} "${v}"`).join(', ')}.
          </p>
        )}
      </div>
    </Card>
  );
}

export function VersionUpload() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const policy = useRecord('policy', id);
  const versions = useFetch<DocVersion[]>(`/api/policies/${id}/versions`);
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [converted, setConverted] = useState<Converted | null>(null);
  const [tracked, setTracked] = useState(false);
  const [acceptAsIs, setAcceptAsIs] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [summary, setSummary] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const unsaved = useUnsavedChanges(Boolean(upload));

  const ext = file ? extensionOf(file.name) : '';
  const word = ext === 'docx';

  const text = useDebounced(markdown, 400);
  useEffect(() => {
    let live = true;
    if (!text.trim()) { setPreview(''); return undefined; }
    api.post<{ html: string }>('/api/policies/preview', { body: text }).then((r) => { if (live) setPreview(r.html); }).catch(() => undefined);
    return () => { live = false; };
  }, [text]);

  const convert = async (up: Upload, asIs: boolean) => {
    setMessage('');
    setTracked(false);
    try {
      const out = await api.post<Converted>('/api/documents/convert', { upload_id: up.id, accept_as_is: asIs || undefined });
      setConverted(out);
      setMarkdown(out.markdown);
      setAcceptAsIs(asIs);
      if (out.report.suggested?.version_label) setLabel((l) => l || out.report.suggested!.version_label);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'tracked_changes') setTracked(true);
      else setMessage(errorMessage(err));
    }
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setUpload(null); setConverted(null); setMarkdown(''); setMessage(''); setTracked(false); setProgress(0);
    try {
      const up = await uploadInParts(f, setProgress);
      setUpload(up);
      if (extensionOf(f.name) === 'docx') await convert(up, false);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  const save = async () => {
    if (!upload) return;
    setBusy(true);
    setMessage('');
    try {
      const common = { source_upload_id: upload.id, change_summary: summary || undefined, version_label: label || undefined };
      let saved: DocVersion;
      if (word && converted) {
        saved = await api.post<DocVersion>(`/api/policies/${id}/versions`, { ...common, convert: true, accept_as_is: acceptAsIs || undefined });
        // The text was corrected here: keep the correction, with the stored pictures in place.
        if (markdown !== converted.markdown) {
          const ids = (saved.conversion as { image_attachment_ids?: string[] } | null)?.image_attachment_ids ?? [];
          await api.patch(`/api/policies/${id}/versions/${saved.id}`, { body: placeImages(markdown, ids) });
        }
      } else {
        saved = await api.post<DocVersion>(`/api/policies/${id}/versions`, { ...common, content_kind: 'file' });
      }
      toast.success(`Draft version ${saved.version} saved with its original file.`);
      unsaved.release();
      navigate(`${recordPath(id)}?tab=versions`);
    } catch (err) {
      setMessage(err instanceof ApiError && Object.keys(err.fields ?? {}).length ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const back = recordPath(id);
  const crumbs = [{ label: 'Document register', to: '/documents/register' }, { label: policy.row?.doc_number || policy.row?.ref || 'Document', to: back }, { label: 'Upload a version' }];
  if (policy.error || versions.error) {
    return <><PageHeader title="Upload a version" breadcrumbs={crumbs} /><ErrorState error={policy.error ?? versions.error} onRetry={() => { policy.reload(); versions.reload(); }} /></>;
  }
  if (!policy.row || !versions.data) return <><PageHeader title="Upload a version" breadcrumbs={crumbs} /><Loading lines={8} /></>;

  const latest = versions.data[0];
  const blocked = policy.row.status === 'retired' ? 'This document is obsolete, so it cannot have a new version.'
    : latest && ['draft', 'in_review', 'approved'].includes(latest.status)
      ? `Version ${latest.version} is still ${latest.status === 'draft' ? 'a draft' : latest.status === 'in_review' ? 'in review' : 'approved and not yet published'}. Finish or discard it before uploading another.`
      : '';
  if (blocked) {
    return (
      <>
        <PageHeader title="Upload a version" subtitle={policy.row.title} breadcrumbs={crumbs} />
        <Card><EmptyState icon="lock" title="Not now" message={blocked} action={<Link className="btn btn-primary" to={back}>Back to the document</Link>} /></Card>
      </>
    );
  }
  const next = (latest?.version ?? 0) + 1;
  const ready = Boolean(upload && (!word || converted));

  return (
    <div className="stack">
      <PageHeader
        title={`Upload version ${next}`} subtitle={policy.row.title} breadcrumbs={crumbs}
        actions={<><Link className="btn btn-secondary" to={back}>Cancel</Link><Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>Save draft</Button></>}
      />
      <Card title="File">
        <div className="stack">
          <p className="muted">
            A Word document (.docx) is converted to text you can check and correct here. A PDF is kept as it is and its text is read for search.
            Older Word files (.doc) are kept as the original only: save them as .docx in Word to convert them. The file is kept with the version either way.
          </p>
          <input ref={input} type="file" className="sr-only" accept=".docx,.pdf,.doc,.odt,.rtf" onChange={(e) => void choose(e)} aria-label="Choose the file" />
          <span className="row">
            <Button icon="upload" onClick={() => input.current?.click()} disabled={progress !== null}>{file ? 'Choose another file' : 'Choose a file'}</Button>
            {file && <span>{file.name}</span>}
          </span>
          {progress !== null && <ProgressBar value={Math.round(progress * 100)} label="Upload progress" />}
          {message && <Notice tone="error">{message}</Notice>}
          {tracked && upload && (
            <Notice tone="warning" title="The document has tracked changes">
              Accept or reject the changes in Word and upload it again, or convert it as it is: insertions are kept and deletions are left out.{' '}
              <Button size="sm" onClick={() => void convert(upload, true)}>Convert as it is</Button>
            </Notice>
          )}
          {upload && !word && (
            <Notice tone={ext === 'pdf' ? 'info' : 'warning'}>
              {ext === 'pdf'
                ? 'This PDF becomes a file version: readers open it as a controlled copy, and its text is searchable once it has been read. A scanned PDF with no text is found by its number and title only.'
                : `A .${ext} file cannot be converted. It is kept as the original file of a file version, found by its number and title only.`}
            </Notice>
          )}
          {upload?.scan_warning && <Notice tone="warning">{upload.scan_warning}</Notice>}
          {upload && (
            <div className="grid-2">
              <TextField label="What changed in this version" value={summary} maxLength={300} onChange={setSummary} placeholder="For example: annual update" />
              <TextField label="Revision label" value={label} maxLength={40} onChange={setLabel} hint="As the organization knows it, for example Rev. C. Leave empty to use the version number." />
            </div>
          )}
        </div>
      </Card>
      {converted && (
        <>
          <ConversionReportCard report={converted.report} imageCount={converted.images?.length ?? Number(converted.report.images ?? 0)} />
          <div className="pol-compare">
            <Card title="Text">
              <div className="stack pol-editor">
                <TextArea label="Converted text" rows={22} value={markdown} onChange={setMarkdown} />
                <p className="pol-help">Correct anything the conversion got wrong. Pictures show as <code>attachment:</code> links until the draft is saved.</p>
              </div>
            </Card>
            <Card title="Preview">
              <div className="pol-preview" aria-live="polite"><PolicyBody html={preview} empty="The preview appears here." /></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
