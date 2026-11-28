// The register of issued paper copies (E43-14): who holds each numbered controlled copy, of which
// version, and the recalls. Copies of a version no longer in force are flagged "Recall"; they are in the
// document owner's My work until each is recorded as recalled. A copy still out of the version in force
// can be printed for its holder, with its number and holder on every page (E46-57).
import { useState } from 'react';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal, Notice, StatusChip,
  TableWrap, TextArea, TextField, UserPicker, useFetch, useToast,
} from '../../../core';
import { isoDay } from '../shared';

interface Copy {
  id: string; copy_number: number; version: number | null; version_label: string | null; version_status: string | null;
  holder_user_id: string | null; holder_name: string; location: string | null; issued_on: string; issued_by_name: string | null;
  recalled_on: string | null; recalled_by_name: string | null; recall_note: string | null; notes: string | null; recall_due: boolean;
}
interface Register { rows: Copy[]; out: number; recall_due: number; can_edit: boolean; next_number: number }

function IssueDialog({ docId, next, onClose, onDone }: { docId: string; next: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ holder_user_id: null as string | null, holder_name: '', location: '', issued_on: isoDay(), notes: '', copy_number: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const c = await api.post<Copy>(`/api/policies/${docId}/copies`, {
        holder_user_id: form.holder_user_id || undefined, holder_name: form.holder_name.trim() || undefined, location: form.location.trim() || undefined,
        issued_on: form.issued_on || undefined, notes: form.notes.trim() || undefined, copy_number: form.copy_number ? Number(form.copy_number) : undefined,
      });
      toast.success(`Copy ${c.copy_number} issued to ${c.holder_name}. Print it from the register: its number and holder are on every page.`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Issue a paper copy" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Issue the copy</Button></>}>
      <div className="stack">
        <p className="muted">A numbered controlled copy of the version in force. When a later version takes effect, the copy is due to be recalled.</p>
        <UserPicker label="Held by (a person with an account)" value={form.holder_user_id} onChange={(id) => set({ holder_user_id: id })} error={errors.holder_user_id} />
        <TextField label="Or held by (a name or a place)" value={form.holder_name} onChange={(v) => set({ holder_name: v })} error={errors.holder_name}
          hint="For example a depot's operations binder, or the name of someone without an account." />
        <TextField label="Where it is kept" value={form.location} onChange={(v) => set({ location: v })} error={errors.location} />
        <TextField label="Copy number" value={form.copy_number} onChange={(v) => set({ copy_number: v.replace(/[^0-9]/g, '') })} error={errors.copy_number}
          hint={`Empty: the next free number (${next}).`} />
        <DateField label="Issued on" value={form.issued_on} onChange={(v) => set({ issued_on: v ?? '' })} error={errors.issued_on} />
        <TextArea label="Notes" value={form.notes} onChange={(v) => set({ notes: v })} rows={2} />
        {errors.version_id && <Notice tone="warning">{errors.version_id}</Notice>}
      </div>
    </Modal>
  );
}

function RecallDialog({ docId, copy, onClose, onDone }: { docId: string; copy: Copy; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(isoDay());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/api/policies/${docId}/copies/${copy.id}/recall`, { recalled_on: on || undefined, note: note.trim() || undefined });
      toast.success(`Copy ${copy.copy_number} recorded as recalled.`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`Recall copy ${copy.copy_number}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Record the recall</Button></>}>
      <div className="stack">
        <p>Held by {copy.holder_name}{copy.location ? `, ${copy.location}` : ''}.</p>
        <DateField label="Recalled on" value={on} onChange={(v) => setOn(v ?? '')} error={errors.recalled_on} />
        <TextArea label="Note" value={note} onChange={setNote} rows={2} placeholder="For example: collected and destroyed" />
      </div>
    </Modal>
  );
}

/** The register of a document's paper copies, on its record page. */
export function CopiesPanel({ docId }: { docId: string }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Register>(`/api/policies/${docId}/copies`);
  const [issuing, setIssuing] = useState(false);
  const [recalling, setRecalling] = useState<Copy | null>(null);
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={3} label="Loading the paper copies" /></Card>;
  const remove = async (c: Copy) => {
    try {
      await api.del(`/api/policies/${docId}/copies/${c.id}`);
      toast.success(`Copy ${c.copy_number} taken out of the register.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="stack" id="copies">
      {data.recall_due > 0 && (
        <Notice tone="warning" title={`${data.recall_due} paper ${data.recall_due === 1 ? 'copy is' : 'copies are'} due to be recalled`}>
          A later version is in force, or the document is obsolete. Collect each copy and record its recall.
        </Notice>
      )}
      <Card flush title="Paper copies" actions={data.can_edit ? <Button size="sm" icon="plus" onClick={() => setIssuing(true)}>Issue a copy</Button> : undefined}>
        {data.rows.length === 0 ? (
          <EmptyState icon="book" title="No paper copies issued"
            message="Record each numbered controlled copy handed out (to a person or kept at a place such as a depot binder), so the copies can be recalled when a new version takes effect." />
        ) : (
          <TableWrap label="Paper copies">
            <table className="table doc-copies">
              <thead>
                <tr>
                  <th scope="col" className="num">Copy</th><th scope="col">Version</th><th scope="col">Held by</th><th scope="col">Issued</th>
                  <th scope="col">Recalled</th>{data.can_edit && <th scope="col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{c.copy_number}</td>
                    <td>{c.version ? `Version ${c.version}${c.version_label ? ` (${c.version_label})` : ''}` : '—'}</td>
                    <td>{c.holder_name}{c.location ? <div className="muted">{c.location}</div> : null}</td>
                    <td>{formatDate(c.issued_on)}{c.issued_by_name ? <div className="muted">by {c.issued_by_name}</div> : null}</td>
                    <td>
                      {c.recalled_on
                        ? <>{formatDate(c.recalled_on)}{c.recalled_by_name ? <span className="muted"> by {c.recalled_by_name}</span> : null}{c.recall_note ? <div className="muted">{c.recall_note}</div> : null}</>
                        : c.recall_due ? <StatusChip color="amber" label="Due for recall" /> : <span className="muted">Out</span>}
                    </td>
                    {data.can_edit && (
                      <td className="doc-copies-actions">
                        {!c.recalled_on && !c.recall_due && (
                          <Button size="sm" variant="secondary" onClick={() => window.open(`/api/policies/${docId}/copies/${c.id}/pdf`, '_blank', 'noopener')}
                            aria-label={`Print copy ${c.copy_number} for ${c.holder_name}`}>Print</Button>
                        )}
                        {!c.recalled_on && <Button size="sm" variant="secondary" onClick={() => setRecalling(c)} aria-label={`Record the recall of copy ${c.copy_number}`}>Recall</Button>}
                        {!c.recalled_on && <Button size="sm" variant="ghost" onClick={() => void remove(c)} aria-label={`Take copy ${c.copy_number} out of the register (entered by mistake)`}>Remove</Button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {issuing && <IssueDialog docId={docId} next={data.next_number} onClose={() => setIssuing(false)} onDone={() => { setIssuing(false); reload(); }} />}
      {recalling && <RecallDialog docId={docId} copy={recalling} onClose={() => setRecalling(null)} onDone={() => { setRecalling(null); reload(); }} />}
    </div>
  );
}
