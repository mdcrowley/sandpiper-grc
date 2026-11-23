// A change's safety assessment (E25-11): whether the change affects safety and the hazards linked to it
// as its assessment. Shown only while the safety area is on. A change that affects safety cannot be
// submitted for approval, scheduled or started until at least one hazard is linked.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EditableSummary, EmptyState, ErrorState, errorMessage, Loading, Modal, RecordPicker, StatusChip, TableWrap, TextArea, TextField,
  useAuth, useFetch, useToast, type Row,
} from '../../core';

interface Assessment {
  available: boolean; safety_impact: boolean; required: boolean; count: number;
  hazards: { id: string; ref: string; title: string; status: string; rating: string | null }[];
}

export function useSafetyAssessment(changeId: string, version: unknown) {
  const { areaOn } = useAuth();
  return useFetch<Assessment>(areaOn('safety') ? `/api/changes/${changeId}/safety-assessment?v=${encodeURIComponent(String(version ?? ''))}` : null);
}

export function SafetyAssessment({ row, canEdit, onChanged }: { row: Row; canEdit: boolean; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useSafetyAssessment(row.id, row.updated_at);
  const [mode, setMode] = useState<'link' | 'new' | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [consequence, setConsequence] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const mayLink = canEdit && can('safety.view') && !['closed', 'cancelled'].includes(row.status);
  const done = () => { setMode(null); reload(); onChanged(); };
  const save = async () => {
    setBusy(true); setErr(undefined);
    try {
      if (mode === 'link') await api.post(`/api/changes/${row.id}/safety-assessment`, { hazard_id: pick });
      else await api.post(`/api/changes/${row.id}/safety-assessment`, { title, consequence: consequence || null });
      toast.success(mode === 'link' ? 'Hazard linked.' : 'Hazard created and linked.'); done();
    } catch (e) {
      const fields = (e as { fields?: Record<string, string> }).fields;
      if (fields) setErr(fields.title ?? fields.hazard_id); else toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };
  const unlink = async (id: string) => {
    try { await api.del(`/api/changes/${row.id}/safety-assessment/${id}`); toast.success('Hazard unlinked.'); reload(); onChanged(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} />;
  return (
    <div className="stack">
      <EditableSummary type="change" row={row} title="Safety" fields={['safety_impact']} onSaved={onChanged}
        editable={row.status === 'draft' ? undefined : false} />
      <Card title="Safety assessment" flush actions={mayLink && <>
        <Button size="sm" icon="link" onClick={() => { setPick(null); setErr(undefined); setMode('link'); }}>Link a hazard</Button>
        {can('safety.create') && <Button size="sm" icon="plus" onClick={() => { setTitle(''); setConsequence(''); setErr(undefined); setMode('new'); }}>Create hazard from this change</Button>}
      </>}>
        <p className="muted chg-pad">
          {data.safety_impact
            ? data.required
              ? 'This change affects safety: link at least one hazard as its safety assessment before it is submitted for approval, scheduled or started.'
              : 'This change affects safety and has a safety assessment.'
            : 'This change is not marked as affecting safety. Hazards may still be linked.'}
        </p>
        {data.hazards.length === 0
          ? <EmptyState icon="shield" title={data.count ? `${data.count} hazard${data.count === 1 ? '' : 's'} linked` : 'No hazards linked'}
            message={data.count ? 'You may not see the hazard log.' : 'Link the hazards this change brings or changes, assessed in the hazard log.'} />
          : (
            <TableWrap label="Hazards linked as the safety assessment">
              <table className="table">
                <caption className="sr-only">Hazards linked as the safety assessment</caption>
                <thead><tr><th scope="col">Hazard</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.hazards.map((h) => (
                    <tr key={h.id}>
                      <td><Link className="row-title" to={`/safety/hazards/${h.id}`}><span className="ref">{h.ref}</span> {h.title}</Link></td>
                      <td>{h.rating ? <StatusChip color="gray" label={h.rating} /> : <span className="muted">Not scored</span>}</td>
                      <td className="chg-actions-cell">{mayLink && <Button size="sm" variant="ghost" aria-label={`Unlink: ${h.ref} ${h.title}`} onClick={() => unlink(h.id)}>Unlink</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      <Modal open={!!mode} size="sm" title={mode === 'link' ? 'Link a hazard' : 'Create a hazard from this change'} onClose={() => setMode(null)}
        dirty={mode === 'link' ? Boolean(pick) : mode === 'new' && Boolean(title.trim() || consequence.trim())}
        footer={<><Button onClick={() => setMode(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={mode === 'link' ? !pick : !title.trim()} onClick={save}>{mode === 'link' ? 'Link' : 'Create and link'}</Button></>}>
        {mode === 'link'
          ? <RecordPicker label="Hazard" type="hazard" required value={pick} onChange={(id) => setPick(id)} error={err} />
          : (
            <div className="form">
              <TextField label="Hazard" required value={title} onChange={setTitle} error={err} hint="What could cause harm once the change is made." />
              <TextArea label="Possible consequence" value={consequence} onChange={setConsequence} rows={3} />
              <p className="muted">The hazard is added to the hazard log with the source "Change or new service", owned by you, for the safety team to score.</p>
            </div>
          )}
      </Modal>
    </div>
  );
}
