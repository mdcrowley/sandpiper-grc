// The Evidence panel: what a record (or one part of it) uses from the evidence library, with "Use
// existing evidence" (reuse: nothing is uploaded twice) and "Upload a file" (filed once in the library).
// Host pages load it with import.meta.glob, so a build without this module still works:
//   const loaders = import.meta.glob<{ EvidencePanel: ComponentType<EvidencePanelProps> }>('../evidence/EvidencePanel.tsx');
// or add `evidenceTab(type)` to a RecordPage's tabs. The server decides who may link (edit permission on
// the record, or a part's own rule such as a document request's assignee) and counts what the reader
// may not see.
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, LookupSelect, Modal,
  RecordPicker, StatusChip, TableWrap, TextArea, TextField, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName, RecordTab } from '../../core';
import { uploadInParts } from './upload';
import './evidence.css';

export type EvidenceState = 'none' | 'current' | 'expiring' | 'expired';

export interface EvidenceLinkRow {
  link_id: string; part: string; part_label: string | null; relation: string; note: string | null; linked_at: string;
  evidence: {
    id: string; ref: string | null; title: string; source: string | null; url: string | null; owner_name: string | null;
    valid_until: string | null; collected_on: string | null; period_start: string | null; period_end: string | null;
    files: number; state: EvidenceState; restricted: boolean;
  };
}
interface LinksAnswer { rows: EvidenceLinkRow[]; hidden: number; total: number; may_view: boolean; may_link: boolean; may_create: boolean }

const STATE: Record<EvidenceState, { label: string; color: ColorName }> = {
  none: { label: 'No expiry', color: 'gray' },
  current: { label: 'Valid', color: 'green' },
  expiring: { label: 'Lapses soon', color: 'amber' },
  expired: { label: 'Lapsed', color: 'red' },
};

/** The expiry state of evidence as a chip, with the date. */
export function EvidenceStateChip({ state, validUntil }: { state: EvidenceState; validUntil?: string | null }) {
  const s = STATE[state] ?? STATE.none;
  return <StatusChip size="sm" color={s.color} label={validUntil && state !== 'none' ? `${s.label} · ${formatDate(validUntil)}` : s.label} />;
}

/** Works out the state the server gives, for list rows that only carry the date. */
export function stateOf(validUntil: string | null | undefined, today: string, days: number): EvidenceState {
  if (!validUntil) return 'none';
  const v = validUntil.slice(0, 10);
  if (v < today) return 'expired';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + days);
  return v <= soon.toISOString().slice(0, 10) ? 'expiring' : 'current';
}

export interface EvidencePanelProps {
  recordType: string;
  recordId: string;
  /** One part of the record ('area:FM', 'request:<id>'); leave out for the record itself and all its parts. */
  part?: string;
  /** Card title. Default "Evidence". */
  title?: string;
  /** Leave out the card frame (inside another card, such as a review area). */
  bare?: boolean;
  /**
   * Files go somewhere else than the library's own upload route (a funder document request answers with
   * its own route, which also lets its assignee upload). Gets the finished upload's id and the form.
   */
  uploadTo?: (uploadId: string, form: { title: string; valid_until: string | null }) => Promise<unknown>;
  /** Whether "Upload a file" is offered; default: the reader may create evidence records and link here. */
  mayUpload?: boolean;
  /** Called after a link is added or removed (counts on the host page). */
  onChange?: () => void;
}

function UseExisting({ props, onClose, onSaved }: { props: EvidencePanelProps; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<string | null>(null);
  const [relation, setRelation] = useState(props.part?.startsWith('request:') ? 'responds' : 'supports');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(pick) || Boolean(note);
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post('/api/evidence-links', { evidence_id: pick, record_type: props.recordType, record_id: props.recordId, part: props.part ?? '', relation, note: note || null });
      unsaved.release();
      toast.success('Evidence linked.');
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Use evidence from the library" size="sm" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={save}>Use it</Button></>}>
      <div className="stack">
        <p className="muted">Pick evidence already filed in the library, so the same document serves this record too.</p>
        <RecordPicker label="Evidence record" type="evidence_record" required value={pick} onChange={(id) => setPick(id)} />
        <LookupSelect label="How it relates" list="evidence_relation" required value={relation} onChange={setRelation} />
        <TextArea label="Note" value={note} rows={2} onChange={setNote} hint="Optional: the page or section that answers it." />
      </div>
    </Modal>
  );
}

function UploadNew({ props, onClose, onSaved }: { props: EvidencePanelProps; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = Boolean(file) || Boolean(title);
  const unsaved = useUnsavedChanges(dirty);
  const save = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const up = await uploadInParts(file, setProgress);
      const form = { title: title.trim() || file.name, valid_until: validUntil || null };
      if (props.uploadTo) await props.uploadTo(up.id, form);
      else {
        await api.post('/api/evidence-library/upload', {
          upload_id: up.id, ...form, record_type: props.recordType, record_id: props.recordId, part: props.part ?? '',
          relation: props.part?.startsWith('request:') ? 'responds' : 'supports',
        });
      }
      unsaved.release();
      toast.success('File filed in the evidence library and linked.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally { setProgress(null); }
  };
  return (
    <Modal open title="Upload a file as evidence" size="sm" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={unsaved.guard(onClose)}>Cancel</Button><Button variant="primary" loading={progress !== null} disabled={!file} onClick={save}>Upload</Button></>}>
      <div className="stack">
        <p className="muted">The file is filed once in the evidence library, so other records can use it later without uploading it again.</p>
        <label className="ev-file" htmlFor={inputId}>
          <span>{file ? file.name : 'Choose a file'}</span>
          <input id={inputId} type="file" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '')); }} />
        </label>
        <TextField label="Title" value={title} onChange={setTitle} hint="What the file shows, as it should appear in the library." />
        <DateField label="Valid until" value={validUntil} onChange={setValidUntil} hint="Optional: when it must be renewed. Its owner is reminded before then." />
        {progress !== null && <p className="muted" role="status">Uploading… {Math.round(progress * 100)}%</p>}
        {error && <p className="ev-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

export function EvidencePanel(props: EvidencePanelProps) {
  const { recordType, recordId, part, title = 'Evidence', bare, onChange } = props;
  const toast = useToast();
  const query = `/api/evidence-links?record_type=${encodeURIComponent(recordType)}&record_id=${encodeURIComponent(recordId)}${part !== undefined ? `&part=${encodeURIComponent(part)}` : ''}`;
  const { data, error, reload } = useFetch<LinksAnswer>(query);
  const [dialog, setDialog] = useState<'existing' | 'upload' | null>(null);
  const [removing, setRemoving] = useState<EvidenceLinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => { setDialog(null); reload(); onChange?.(); };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/evidence-links/${removing.link_id}`);
      toast.success('No longer used here. The evidence record stays in the library.');
      setRemoving(null); reload(); onChange?.();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const mayUpload = props.mayUpload ?? Boolean(data?.may_create && data?.may_link);
  const showParts = part === undefined && (data?.rows ?? []).some((r) => r.part);
  const actions = data?.may_link && (
    <div className="ev-actions">
      <Button size="sm" icon="link" onClick={() => setDialog('existing')}>Use existing evidence</Button>
      {mayUpload && <Button size="sm" icon="upload" onClick={() => setDialog('upload')}>Upload a file</Button>}
    </div>
  );

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <div className="ev-pad"><Loading lines={3} label="Loading evidence" /></div>;
  else if (!data.may_view) {
    body = <EmptyState icon="lock" title={data.total ? `${data.total} evidence record${data.total === 1 ? '' : 's'}` : 'No evidence yet'}
      message="Ask for permission to view the evidence library to open them." />;
  } else if (data.rows.length === 0 && !data.hidden) {
    body = <EmptyState icon="paperclip" title="No evidence yet" message={data.may_link ? 'Use evidence already in the library, or upload a file.' : 'Nothing from the evidence library is used here yet.'} />;
  } else {
    body = (
      <>
        {data.rows.length > 0 && (
          <TableWrap label={`${title} used`}>
            <table className="table">
              <caption className="sr-only">{title} used</caption>
              <thead>
                <tr>
                  <th scope="col">Evidence</th>
                  {showParts && <th scope="col">For</th>}
                  <th scope="col">Relation</th>
                  <th scope="col">Validity</th>
                  <th scope="col">Source</th>
                  {data.may_link && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.link_id}>
                    <td>
                      <Link className="row-title" to={`/evidence-library/${r.evidence.id}`}>{r.evidence.ref && <span className="ref">{r.evidence.ref}</span>} {r.evidence.title}</Link>
                      {r.note && <span className="muted ev-small ev-block">{r.note}</span>}
                    </td>
                    {showParts && <td>{r.part_label ?? 'The record itself'}</td>}
                    <td><LookupChip list="evidence_relation" value={r.relation} /></td>
                    <td><EvidenceStateChip state={r.evidence.state} validUntil={r.evidence.valid_until} /></td>
                    <td>
                      {r.evidence.source === 'link' && r.evidence.url
                        ? <a href={r.evidence.url} target="_blank" rel="noreferrer noopener">Link</a>
                        : r.evidence.source === 'document' ? 'Document'
                        : `${r.evidence.files} file${r.evidence.files === 1 ? '' : 's'}`}
                    </td>
                    {data.may_link && (
                      <td className="ev-row-actions">
                        <Button size="sm" variant="ghost" aria-label={`Stop using: ${r.evidence.title}`} onClick={() => setRemoving(r)}>Remove</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data.hidden > 0 && (
          <p className="muted ev-pad ev-small">
            {data.hidden} more evidence record{data.hidden === 1 ? ' is' : 's are'} used here that you cannot open (restricted, or outside your departments).
          </p>
        )}
      </>
    );
  }

  const dialogs = (
    <>
      {dialog === 'existing' && <UseExisting props={props} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog === 'upload' && <UploadNew props={props} onClose={() => setDialog(null)} onSaved={changed} />}
      <ConfirmDialog open={!!removing} title="Stop using this evidence here?" message={`${removing?.evidence.title ?? 'The evidence record'} stays in the library and in the other records that use it.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </>
  );
  if (bare) return <div className="ev-bare stack">{actions}{body}{dialogs}</div>;
  return <Card title={title} flush actions={actions}>{body}{dialogs}</Card>;
}

/** An "Evidence" tab for a RecordPage (any record type the library links to). */
export function evidenceTab(recordType: string): RecordTab {
  return { key: 'evidence', label: 'Evidence', content: ({ row }) => <EvidencePanel recordType={recordType} recordId={String(row.id)} /> };
}
