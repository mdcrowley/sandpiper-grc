// Files sent through a vendor response link (E06-22).
//  - VendorFiles: on the public response page, the vendor sends, lists and removes files.
//  - HeldFiles: on the assessment, staff download each file to look at it, then take it over onto
//    the vendor (as evidence by default) or discard it.
// The server checks every file again (type, content, malware scanner, size, the link's limits).
import { useRef, useState } from 'react';
import {
  api, ApiError, Button, ConfirmDialog, DateField, errorMessage, formatDateTime, Modal, Select, StatusChip, TextField, useToast,
} from '../../core';

export interface SentFile {
  id: string; file_name: string; type_group: string; size_bytes: number; description: string | null; uploaded_at: string;
}
export interface HeldFile extends SentFile {
  extension: string; sha256: string; scan_status: 'clean' | 'not_scanned'; scan_engine: string | null; uploaded_by_name: string | null;
}
export interface UploadLimits { available: boolean; max_files: number; max_bytes: number; max_file_bytes: number; file_types: string[] }

export function formatSize(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** One file as the raw request body, with the same security header as every other change. */
async function sendFile(token: string, file: File, description: string): Promise<SentFile> {
  const params = new URLSearchParams({ name: file.name });
  if (description.trim()) params.set('description', description.trim());
  let res: Response;
  try {
    res = await fetch(`/api/vendor-response/${encodeURIComponent(token)}/files?${params}`, {
      method: 'PUT', body: file, credentials: 'same-origin',
      headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
    });
  } catch {
    throw new ApiError(0, 'network', 'The file could not be sent. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } } & Partial<SentFile>;
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? `http_${res.status}`, body.error?.message ?? `The file could not be sent (${res.status}).`);
  return body as SentFile;
}

export function VendorFiles({ token, files, limits, sent, onChange }: {
  token: string; files: SentFile[]; limits: UploadLimits; sent: boolean; onChange: (files: SentFile[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [removing, setRemoving] = useState<SentFile | null>(null);
  if (!limits.available && !files.length) return null;
  const used = files.reduce((n, f) => n + f.size_bytes, 0);

  async function choose(list: FileList | null) {
    if (!list?.length) return;
    const out: string[] = [];
    let current = [...files];
    for (const file of Array.from(list)) {
      const ext = extensionOf(file.name);
      const total = current.reduce((n, f) => n + f.size_bytes, 0);
      if (!limits.file_types.includes(ext)) { out.push(`"${file.name}": files of this type cannot be sent. Allowed: ${limits.file_types.join(', ')}.`); continue; }
      if (file.size === 0) { out.push(`"${file.name}" is empty.`); continue; }
      if (current.length >= limits.max_files) { out.push(`"${file.name}": you can send up to ${limits.max_files} files through this link.`); continue; }
      if (file.size > limits.max_file_bytes || total + file.size > limits.max_bytes) { out.push(`"${file.name}" is too large (${formatSize(file.size)}).`); continue; }
      setBusy(file.name);
      try {
        current = [...current, await sendFile(token, file, description)];
        onChange(current);
      } catch (err) {
        out.push(`"${file.name}": ${errorMessage(err)}`);
      }
    }
    setBusy(null);
    setProblems(out);
    if (!out.length) setDescription('');
    if (input.current) input.current.value = '';
  }

  async function remove() {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api.del(`/api/vendor-response/${encodeURIComponent(token)}/files/${removing.id}`);
      onChange(files.filter((f) => f.id !== removing.id));
    } catch (err) {
      setProblems([errorMessage(err)]);
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  }

  return (
    <section className="vnd-files" aria-labelledby="vr-files-title">
      <h2 id="vr-files-title" className="vnd-files-title">Supporting files</h2>
      <p className="muted">
        {sent ? 'The files you sent with your answers.' : <>Optional: certificates, reports or policies that back your answers. Up to {limits.max_files} files and {formatSize(limits.max_bytes)} in all; types {limits.file_types.join(', ')}. Our staff review each file before using it.</>}
      </p>
      {files.length > 0 && (
        <ul className="vnd-files-list">
          {files.map((f) => (
            <li key={f.id}>
              <span className="vnd-files-name">{f.file_name}</span>
              <span className="vnd-files-meta">{formatSize(f.size_bytes)} · {formatDateTime(f.uploaded_at)}{f.description ? ` · ${f.description}` : ''}</span>
              {!sent && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRemoving(f)}>
                  Remove<span className="sr-only">: {f.file_name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!sent && limits.available && (
        <div className="vnd-files-add">
          <TextField label="What the files show" value={description} onChange={setDescription} maxLength={500}
            hint="Optional, for the files you choose next: for example, the question they support." />
          <input ref={input} type="file" multiple hidden aria-hidden="true" tabIndex={-1}
            accept={limits.file_types.map((x) => `.${x}`).join(',')} onChange={(e) => void choose(e.currentTarget.files)} />
          <div className="row">
            <Button icon="upload" loading={busy !== null && !removing} disabled={busy !== null || files.length >= limits.max_files} onClick={() => input.current?.click()}>
              Choose files to send
            </Button>
            <span className="muted vnd-files-used" aria-live="polite">
              {busy && !removing ? `Sending ${busy}…` : `${files.length} of ${limits.max_files} files · ${formatSize(used)} of ${formatSize(limits.max_bytes)}`}
            </span>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <div className="notice notice-warn" role="alert">
          {problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      )}
      <ConfirmDialog
        open={removing !== null} title="Remove this file?" danger confirmLabel="Remove file" busy={busy === removing?.id}
        message={removing ? `"${removing.file_name}" will not be sent.` : ''}
        onCancel={() => setRemoving(null)} onConfirm={() => void remove()}
      />
    </section>
  );
}

/** Staff: files waiting on the links of an assessment. */
export function HeldFiles({ assessmentId, files, editable, onChange }: {
  assessmentId: string; files: (HeldFile & { link_id: string })[]; editable: boolean; onChange: () => void;
}) {
  const toast = useToast();
  const [taking, setTaking] = useState<(HeldFile & { link_id: string }) | null>(null);
  const [discarding, setDiscarding] = useState<(HeldFile & { link_id: string }) | null>(null);
  const [kind, setKind] = useState('evidence');
  const [expires, setExpires] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!files.length) return null;
  const base = (f: { link_id: string; id: string }) => `/api/vendor-assessments/${assessmentId}/links/${f.link_id}/files/${f.id}`;

  async function take() {
    if (!taking) return;
    setBusy(true);
    setErrors({});
    try {
      await api.post(`${base(taking)}/accept`, { kind, description, expires_on: kind === 'evidence' && expires ? expires : undefined });
      toast.success(`"${taking.file_name}" is now on the vendor's Attachments tab.`);
      setTaking(null);
      onChange();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields!);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!discarding) return;
    setBusy(true);
    try {
      await api.post(`${base(discarding)}/discard`, {});
      toast.success('File discarded.');
      onChange();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setDiscarding(null);
    }
  }

  return (
    <div className="vnd-link-review">
      <div className="vnd-link-review-head">
        <strong>{files.length} file{files.length === 1 ? '' : 's'} from the vendor to review</strong>
      </div>
      <ul className="vnd-link-list">
        {files.map((f) => (
          <li key={f.id}>
            <span className="vnd-link-q">
              <a href={`${base(f)}/download`} download>{f.file_name}</a>{' '}
              <StatusChip size="sm" color={f.scan_status === 'clean' ? 'green' : 'gray'} label={f.scan_status === 'clean' ? 'Scanned' : 'Not scanned'} />
            </span>
            <span className="vnd-link-a muted">
              {formatSize(f.size_bytes)} · sent {formatDateTime(f.uploaded_at)}{f.uploaded_by_name ? ` by ${f.uploaded_by_name}` : ''}{f.description ? ` · “${f.description}”` : ''}
            </span>
            {editable && (
              <span className="row vnd-link-actions">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDiscarding(f)}>Discard<span className="sr-only">: {f.file_name}</span></Button>
                <Button size="sm" disabled={busy} onClick={() => { setTaking(f); setKind('evidence'); setExpires(''); setDescription(f.description ?? ''); setErrors({}); }}>
                  Take over<span className="sr-only">: {f.file_name}</span>
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Modal open={taking !== null} title="Take over this file" size="md" onClose={() => setTaking(null)} dirty={description !== '' || expires !== '' || kind !== 'evidence'}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void take(); }} noValidate>
          <p className="muted">“{taking?.file_name}” becomes a file on the vendor. Download it and look at it first if you have not.</p>
          <Select label="Keep it as" value={kind} onChange={setKind} options={[{ value: 'evidence', label: 'Evidence of the vendor' }, { value: 'file', label: 'An ordinary file' }]} error={errors.kind} />
          <TextField label="Description" value={description} onChange={setDescription} error={errors.description} maxLength={2000} />
          {kind === 'evidence' && <DateField label="Expires on" value={expires} onChange={setExpires} error={errors.expires_on} hint="Optional: when the certificate or report stops being current." />}
          <div className="form-actions">
            <Button onClick={() => setTaking(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>Take over</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={discarding !== null} title="Discard this file?" danger confirmLabel="Discard file" busy={busy}
        message={discarding ? `"${discarding.file_name}" is deleted and cannot be brought back. The vendor is not told.` : ''}
        onCancel={() => setDiscarding(null)} onConfirm={() => void discard()}
      />
    </div>
  );
}
