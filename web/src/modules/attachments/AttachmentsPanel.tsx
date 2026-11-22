// The files attached to one record: add (drag and drop or a file picker), list, download,
// edit and remove. Embed it on any record page:
//
//   <AttachmentsPanel recordType="ticket" recordId={row.id} />
//   <AttachmentsPanel recordType="framework_outcome" recordId={row.id} evidence />
//
// With `evidence`, new files are recorded as evidence with a collection date and an optional
// expiry date. What the person may do is decided by the server from the record's permissions.
import { useCallback, useRef, useState, type DragEvent } from 'react';
import {
  Badge, Button, Checkbox, ConfirmDialog, cx, DateField, EmptyState, ErrorState, errorMessage, formatDate, Icon,
  IconButton, Loading, ProgressBar, qs, relativeTime, StatusChip, api, useFetch, useToast,
} from '../../core';
import { AttachmentEditDialog } from './AttachmentEditDialog';
import { LinkDialog } from './LinkDialog';
import { downloadAttachment, expiryState, FileTypeIcon, formatBytes, formatLimit, linkCheckState, type Attachment, type FileConfig } from './shared';
import { refusalFor, uploadFile } from './upload';
import './attachments.css';

export interface AttachmentsPanelProps {
  /** Record type key, for example "ticket". */
  recordType: string;
  /** Record id. */
  recordId: string;
  /** Record new files as evidence, and ask for the collection and expiry dates. */
  evidence?: boolean;
  /** Called after files are added, edited or removed, e.g. to refresh a count shown elsewhere. */
  onChange?: () => void;
}

/** Fired on `window` after the files of a record change; `detail` is `{ recordType, recordId }`. */
export const ATTACHMENTS_CHANGED = 'grc:attachments-changed';

interface ListResponse { rows: Attachment[]; canEdit: boolean; today: string; linkCheckDays?: number }

interface QueueItem {
  key: number;
  name: string;
  size: number;
  progress: number;
  state: 'waiting' | 'sending' | 'failed';
  error?: string;
}

export function AttachmentsPanel({ recordType, recordId, evidence = false, onChange }: AttachmentsPanelProps) {
  const toast = useToast();
  const list = useFetch<ListResponse>(`/api/attachments${qs({ record_type: recordType, record_id: recordId })}`);
  const config = useFetch<FileConfig>('/api/attachments/config');
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const dragDepth = useRef(0);
  const [over, setOver] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [asEvidence, setAsEvidence] = useState(evidence);
  const [collectedOn, setCollectedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [editing, setEditing] = useState<Attachment | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const today = list.data?.today ?? '';
  const canEdit = list.data?.canEdit ?? false;
  const reloadList = list.reload;
  const changed = useRef(onChange);
  changed.current = onChange;
  // Re-read the list and tell whoever shows a count of these files (the record page's tab, a module's own tab).
  const reload = useCallback(() => {
    reloadList();
    changed.current?.();
    window.dispatchEvent(new CustomEvent(ATTACHMENTS_CHANGED, { detail: { recordType, recordId } }));
  }, [reloadList, recordType, recordId]);

  const patch = (key: number, change: Partial<QueueItem>) =>
    setQueue((q) => q.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const items = files.map((file) => ({ file, key: nextKey.current++, refusal: refusalFor(file, config.data) }));
    setQueue((q) => [
      ...q,
      ...items.map(({ file, key, refusal }): QueueItem => ({
        key, name: file.name, size: file.size, progress: 0, state: refusal ? 'failed' : 'waiting', error: refusal ?? undefined,
      })),
    ]);
    let added = 0;
    let unscanned = 0;
    for (const { file, key, refusal } of items) {
      if (refusal) continue;
      patch(key, { state: 'sending' });
      try {
        const saved = await uploadFile(
          file,
          {
            record_type: recordType, record_id: recordId, kind: asEvidence ? 'evidence' : 'file',
            collected_on: asEvidence ? collectedOn || undefined : undefined,
            expires_on: asEvidence ? expiresOn || undefined : undefined,
          },
          (fraction) => patch(key, { progress: fraction }),
        );
        added += 1;
        if (saved.scan_warning) unscanned += 1;
        setQueue((q) => q.filter((item) => item.key !== key));
      } catch (err) {
        patch(key, { state: 'failed', error: errorMessage(err) });
      }
    }
    if (added) {
      toast.success(added === 1 ? 'File attached.' : `${added} files attached.`);
      if (unscanned) {
        toast.info(`The malware scanner could not be reached, so ${unscanned === 1 ? 'one file was' : `${unscanned} files were`} accepted without a scan and marked "Not scanned".`);
      }
      reload();
    }
  }, [config.data, recordType, recordId, asEvidence, collectedOn, expiresOn, toast, reload]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const download = async (att: Attachment) => {
    setBusy(att.id);
    try {
      await downloadAttachment(att);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const markChecked = async (att: Attachment) => {
    setBusy(att.id);
    try {
      await api.post(`/api/attachments/${att.id}/checked`);
      toast.success('Recorded as checked today.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api.del(`/api/attachments/${removing.id}`);
      toast.success(removing.is_link ? 'Link removed.' : 'File removed.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  };

  const limits = config.data
    ? `Up to ${formatLimit(config.data.maxBytes)} each. Allowed types: ${config.data.allowedExtensions.join(', ')}.`
    : '';

  return (
    <div className="att">
      {canEdit && (
        <section className="att-add" aria-label="Attach files">
          <div
            className={cx('att-drop', over && 'att-drop-over')}
            onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setOver(true); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setOver(false); } }}
            onDrop={onDrop}
          >
            <Icon name="upload" size={24} className="att-drop-icon" />
            <p className="att-drop-text">
              {over ? 'Drop the files to attach them' : <>Drag files here, or <span className="sr-only">use the button to</span></>}
            </p>
            {!over && <Button icon="plus" onClick={() => input.current?.click()}>Choose files</Button>}
            {!over && <Button icon="link" onClick={() => setLinking(true)}>Add link</Button>}
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept={config.data?.allowedExtensions.map((e) => `.${e}`).join(',')}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = ''; // so choosing the same file again still fires
                void addFiles(files);
              }}
            />
            {limits && <p className="att-drop-hint">{limits}</p>}
          </div>
          {evidence && (
            <div className="att-evidence">
              <Checkbox
                label="Record new files as evidence" checked={asEvidence} onChange={setAsEvidence}
                hint="Evidence keeps the date it was collected and, if you give one, the date it expires."
              />
              {asEvidence && (
                <div className="att-evidence-dates">
                  <DateField label="Collected on" value={collectedOn || today} max={today || undefined} onChange={setCollectedOn} />
                  <DateField label="Expires on" value={expiresOn} min={collectedOn || today || undefined} onChange={setExpiresOn} hint="Optional" />
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {queue.length > 0 && (
        <ul className="att-queue" aria-label="Uploads">
          {queue.map((item) => (
            <li key={item.key} className={cx('att-queue-item', item.state === 'failed' && 'att-queue-failed')}>
              {item.state === 'failed' ? (
                <div className="att-queue-error" role="alert">
                  <Icon name="alert" size={18} />
                  <div>
                    <strong>{item.name} was not attached.</strong>
                    <span>{item.error}</span>
                  </div>
                  <IconButton icon="x" size="sm" label={`Dismiss the message about ${item.name}`} onClick={() => setQueue((q) => q.filter((i) => i.key !== item.key))} />
                </div>
              ) : (
                <ProgressBar
                  label={`${item.state === 'waiting' ? 'Waiting' : 'Uploading'}: ${item.name} (${formatBytes(item.size)})`}
                  value={Math.round(item.progress * 100)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {list.error ? (
        <ErrorState title="The files could not be loaded" error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading label="Loading files" lines={3} />
      ) : list.data.rows.length === 0 ? (
        <EmptyState
          icon="file-text"
          title={evidence ? 'No evidence files yet' : 'No files attached'}
          message={canEdit ? 'Drag a file onto the box above, choose one from your computer, or add a link to a document kept elsewhere.' : 'Files and links attached to this record will be listed here.'}
        />
      ) : (
        <ul className="att-list" aria-label="Attached files">
          {list.data.rows.map((att) => {
            const expiry = att.kind === 'evidence' ? expiryState(att.expires_on, today) : null;
            const check = att.is_link ? linkCheckState(att.last_checked_on, today, list.data?.linkCheckDays ?? 90) : null;
            const host = att.is_link && att.link_url ? hostOf(att.link_url) : '';
            return (
              <li key={att.id} className="att-item">
                <FileTypeIcon group={att.type_group} />
                <div className="att-main">
                  {att.is_link && att.link_url ? (
                    // Opened in a new tab with no referrer: the document store sees nothing of this page.
                    <a className="att-name att-link" href={att.link_url} target="_blank" rel="noopener noreferrer" title={`Open ${att.file_name} (${host}) in a new tab`}>
                      {att.file_name}
                      <Icon name="external" size={14} />
                    </a>
                  ) : (
                    <button type="button" className="att-name" onClick={() => void download(att)} title={`Download ${att.file_name}`}>
                      {att.file_name}
                    </button>
                  )}
                  {att.description && <p className="att-description">{att.description}</p>}
                  <p className="att-meta">
                    {att.is_link ? <span>Link to {host}</span> : <span>{formatBytes(att.size_bytes)}</span>}
                    <span>{att.uploaded_by_name ?? 'Unknown user'}</span>
                    <time dateTime={att.uploaded_at} title={relativeTime(att.uploaded_at)}>{formatDate(att.uploaded_at)}</time>
                    {att.kind === 'evidence' && att.collected_on && <span>Collected {formatDate(att.collected_on)}</span>}
                    {att.is_link && att.checked_by_name && att.last_checked_on && <span>Checked by {att.checked_by_name}</span>}
                  </p>
                </div>
                <div className="att-chips">
                  {att.is_link && <Badge color="blue">Link</Badge>}
                  {att.kind === 'evidence' && <Badge color="teal">Evidence</Badge>}
                  {check && <StatusChip color={check.color} label={check.label} />}
                  {expiry && <StatusChip color={expiry.color} label={expiry.label} />}
                  {att.kind === 'evidence' && !att.expires_on && <StatusChip color="gray" label="No expiry date" />}
                </div>
                <div className="att-actions">
                  {att.is_link ? (
                    canEdit && <IconButton icon="check" label={`Mark ${att.file_name} as checked today`} disabled={busy === att.id} onClick={() => void markChecked(att)} />
                  ) : (
                    <IconButton icon="download" label={`Download ${att.file_name}`} disabled={busy === att.id} onClick={() => void download(att)} />
                  )}
                  {canEdit && <IconButton icon="edit" label={`Edit details of ${att.file_name}`} onClick={() => setEditing(att)} />}
                  {canEdit && <IconButton icon="trash" label={`Remove ${att.file_name}`} onClick={() => setRemoving(att)} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <AttachmentEditDialog
          attachment={editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {linking && (
        <LinkDialog
          recordType={recordType} recordId={recordId} evidence={asEvidence} today={today}
          onClose={() => setLinking(false)}
          onSaved={() => { setLinking(false); reload(); }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={removing?.is_link ? 'Remove link' : 'Remove file'}
        message={removing?.is_link
          ? `Remove the link "${removing?.file_name}" from this record? The document itself stays where it is. The removal is kept in the record's history.`
          : `Remove "${removing?.file_name}" from this record? People will no longer be able to download it. The removal is kept in the record's history.`}
        confirmLabel={removing?.is_link ? 'Remove link' : 'Remove file'}
        danger
        busy={busy !== null && busy === removing?.id}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/** The host of a link's address, shown beside it so people see where it goes. */
function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'another site'; }
}
