// Extension file (inventory/Extensions.tsx): the Tags panel of asset, site, system and vehicle pages
// (E37-07): current and earlier values, attach, replace and end, last seen and last verified.
// Owner: TAGS-CORE.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Modal, relativeTime, Select, StatusChip,
  TableWrap, TextField, useFetch, useToast, type ColorName,
} from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import type { AssignmentStatus, RecordTags, TagAssignmentView } from './api';
import './tags.css';

const STATUS: Record<AssignmentStatus, { label: string; color: ColorName }> = {
  active: { label: 'On the record', color: 'green' },
  replaced: { label: 'Replaced', color: 'gray' },
  void: { label: 'Void', color: 'red' },
  lost: { label: 'Lost', color: 'amber' },
  ended: { label: 'Removed', color: 'gray' },
};
const SOURCE: Record<string, string> = {
  code: 'read from a code by the app', text: 'read from printed text by the app', typed: 'typed', handheld: 'read by a handheld scanner',
  import: 'from the record', system: 'numbered automatically',
};
const LOOKUP_SOURCE: Record<string, string> = { app_code: 'code read by the app', app_text: 'text read by the app', app_typed: 'typed in the app', web: 'on the web' };

type Dialog = { kind: 'attach' } | { kind: 'replace'; tag: TagAssignmentView } | { kind: 'end'; tag: TagAssignmentView };

function TagsPanel({ recordType, recordId }: InventoryPanelProps) {
  const { data, error, reload } = useFetch<RecordTags>(`/api/asset-tags/record?type=${encodeURIComponent(recordType)}&id=${encodeURIComponent(recordId)}`);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const body = () => {
    if (error) {
      // A record the person may not see answers 404; the record page says so itself.
      if (error instanceof ApiError && error.status === 404) return null;
      return <ErrorState error={error} onRetry={reload} />;
    }
    if (!data) return <Loading lines={2} label="Loading tags" />;
    const manage = data.canManage;
    return (
      <div className="stack">
        {data.held && <div className="notice notice-warn-soft">This record is under a legal hold, so its tags cannot be attached, replaced or ended.</div>}
        {data.current.length === 0 ? (
          <EmptyState
            icon="tag" title="No tag attached"
            message={manage ? 'Attach the number of the tag stuck on it, typed or read by the app.' : 'No asset tag is attached to this record.'}
            action={manage ? <Button icon="plus" onClick={() => setDialog({ kind: 'attach' })}>Attach a tag</Button> : undefined}
          />
        ) : (
          <ul className="tg-panel-list" aria-label="Current tags">
            {data.current.map((tag) => (
              <li key={tag.id} className="tg-panel-item">
                <div>
                  <span className="tg-value">{tag.value}</span>
                  {data.current.length > 1 && tag.primary && <span className="muted"> (shown on the record)</span>}
                  <div className="tg-panel-meta">
                    Attached {formatDateTime(tag.assignedAt)}{tag.assignedByName ? ` by ${tag.assignedByName}` : ''}{tag.source ? `, ${SOURCE[tag.source] ?? tag.source}` : ''}
                  </div>
                </div>
                {manage && (
                  <div className="row">
                    <Button size="sm" icon="refresh" onClick={() => setDialog({ kind: 'replace', tag })} aria-label={`Replace tag ${tag.value}`}>Replace</Button>
                    <Button size="sm" icon="x" onClick={() => setDialog({ kind: 'end', tag })} aria-label={`End tag ${tag.value}`}>End</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && data.current.length > 0 && (
          <div><Button size="sm" variant="ghost" icon="plus" onClick={() => setDialog({ kind: 'attach' })}>Attach another tag</Button></div>
        )}
        {(data.lastSeen || data.lastVerified) && (
          <p className="tg-panel-meta">
            {data.lastSeen && <>Last seen {relativeTime(data.lastSeen.at)} ({formatDateTime(data.lastSeen.at)}){data.lastSeen.byName ? ` by ${data.lastSeen.byName}` : ''}, {LOOKUP_SOURCE[data.lastSeen.source] ?? data.lastSeen.source}. </>}
            {data.lastVerified && <>Last verified in an inventory count {formatDateTime(data.lastVerified.at)}{data.lastVerified.siteLabel ? ` at ${data.lastVerified.siteLabel}` : ''}.</>}
          </p>
        )}
        {data.earlier.length > 0 && (
          <TableWrap label="Earlier tags">
            <table className="table">
              <caption className="sr-only">Earlier tags</caption>
              <thead><tr><th scope="col">Earlier tag</th><th scope="col">What happened</th><th scope="col">When</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {data.earlier.map((tag) => (
                  <tr key={tag.id}>
                    <td className="tg-value">{tag.value}</td>
                    <td>
                      <StatusChip color={STATUS[tag.status].color} label={STATUS[tag.status].label} />
                      {tag.replacedByValue && <span className="muted"> by <span className="tg-value">{tag.replacedByValue}</span></span>}
                    </td>
                    <td>{formatDateTime(tag.endedAt ?? tag.assignedAt)}{tag.endedByName ? ` by ${tag.endedByName}` : ''}</td>
                    <td>{tag.reason ?? <span className="muted">None given</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    );
  };

  return (
    <Card title="Tags" className="tg-panel">
      {body()}
      {dialog && <TagDialog dialog={dialog} recordType={recordType} recordId={recordId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); window.dispatchEvent(new CustomEvent('grc:record-changed', { detail: { recordType, recordId } })); }} />}
    </Card>
  );
}

function TagDialog({ dialog, recordType, recordId, onClose, onDone }: { dialog: Dialog; recordType: string; recordId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'void' | 'lost' | 'ended'>('void');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(value || reason);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (dialog.kind !== 'end' && !value.trim()) f.value = 'Enter the tag number.';
    if (dialog.kind === 'end' && !reason.trim()) f.reason = 'Say why.';
    setErrors(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    setProblem('');
    try {
      if (dialog.kind === 'attach') await api.post('/api/asset-tags/attach', { recordType, recordId, value, source: 'typed' });
      else if (dialog.kind === 'replace') await api.post('/api/asset-tags/replace', { assignmentId: dialog.tag.id, value, source: 'typed', reason: reason || undefined });
      else await api.post('/api/asset-tags/end', { assignmentId: dialog.tag.id, status, reason });
      toast.success(dialog.kind === 'attach' ? 'Tag attached.' : dialog.kind === 'replace' ? 'Tag replaced.' : 'Tag ended.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = dialog.kind === 'attach' ? 'Attach a tag' : dialog.kind === 'replace' ? `Replace tag ${dialog.tag.value}` : `End tag ${dialog.tag.value}`;
  return (
    <Modal open title={title} size="sm" onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {problem && <div className="notice notice-warn" role="alert">{problem}</div>}
        {dialog.kind !== 'end' && (
          <TextField
            label={dialog.kind === 'replace' ? 'New tag number' : 'Tag number'} required autoFocus maxLength={200} value={value} onChange={setValue}
            error={errors.value} hint="Type it, or use a handheld scanner. Spaces and dashes do not matter."
          />
        )}
        {dialog.kind === 'replace' && <p className="muted">The old tag is kept in the history as replaced, pointing at the new one. Remove it from the equipment.</p>}
        {dialog.kind === 'end' && (
          <Select
            label="What happened" required value={status} onChange={(v) => setStatus(v as 'void' | 'lost' | 'ended')} error={errors.status}
            options={[{ value: 'void', label: 'Damaged (void)' }, { value: 'lost', label: 'Lost' }, { value: 'ended', label: 'Removed from the equipment' }]}
          />
        )}
        <TextField label="Reason" required={dialog.kind === 'end'} maxLength={500} value={reason} onChange={setReason} error={errors.reason} />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{dialog.kind === 'attach' ? 'Attach' : dialog.kind === 'replace' ? 'Replace' : 'End tag'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'tags', label: 'Tags', area: 'tags', appliesTo: ['asset', 'site', 'system', 'vehicle'], Panel: TagsPanel },
];
