// Running an inspection on a phone or tablet (E24-06): one item at a time, large yes / no / not
// applicable buttons, a note and photos, each answer saved as soon as it is given. Completing works
// out the result and score and raises a finding for each item not met.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, Badge, Button, Checkbox, ConfirmDialog, errorMessage, ErrorState, Loading, LookupChip, PageHeader, ProgressBar, TextArea, useFetch, useToast,
} from '../../core';
import { AnswerButtons, type ChecklistData, ItemFlags } from './Checklist';
import { loadUploader, uploadAvailable } from './shared';

interface RunData extends ChecklistData {
  inspection: { id: string; ref: string; title: string; status: string; result: string | null; score_pct: number | null; due_on: string | null; target_label: string | null };
}

export function InspectionRun() {
  const { id = '' } = useParams();
  const toast = useToast();
  const url = `/api/inspections/${id}/responses`;
  const { data, error, reload } = useFetch<RunData>(url);
  const [index, setIndex] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [raise, setRaise] = useState(true);
  const [done, setDone] = useState<{ result: string; score_pct: number | null; findings: { id: string; ref: string; title: string }[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const items = useMemo(() => (data ? data.items.filter((i) => !i.removed || data.responses[i.id]?.answer) : []), [data]);
  // Start at the first item not yet answered.
  useEffect(() => {
    if (data && index === null) {
      const first = items.findIndex((i) => !data.responses[i.id]?.answer);
      setIndex(first < 0 ? 0 : first);
    }
  }, [data, items, index]);
  const item = index !== null ? items[index] : undefined;
  const response = item && data ? data.responses[item.id] : undefined;
  useEffect(() => { setNote(response?.note ?? ''); }, [item?.id, response?.note]);

  if (error) return <div className="stack"><PageHeader title="Inspection" /><ErrorState error={error} onRetry={reload} /></div>;
  if (!data || index === null) return <Loading lines={8} label="Loading the inspection" />;
  const ins = data.inspection;
  const back = <Link className="btn btn-ghost btn-sm" to={`/inspections/${ins.id}`}>Inspection details</Link>;

  if (ins.status === 'complete' || done) {
    const result = done?.result ?? ins.result;
    const score = done ? done.score_pct : ins.score_pct;
    return (
      <div className="stack au-run">
        <PageHeader title={ins.title} reference={ins.ref} actions={back} />
        <div className="au-run-card au-run-done">
          <h2>Inspection complete</h2>
          <p className="au-run-result"><LookupChip list="inspection_result" value={result} />{score !== null && score !== undefined && <span> Score {score}%</span>}</p>
          {done?.findings.length ? (
            <>
              <p>{done.findings.length === 1 ? 'One finding was raised:' : `${done.findings.length} findings were raised:`}</p>
              <ul>{done.findings.map((f) => <li key={f.id}><Link to={`/audit-findings/${f.id}`}><span className="ref">{f.ref}</span> {f.title}</Link></li>)}</ul>
            </>
          ) : null}
          <Link className="btn btn-primary" to="/inspections">Back to inspections</Link>
        </div>
      </div>
    );
  }
  if (!items.length) {
    return <div className="stack"><PageHeader title={ins.title} reference={ins.ref} actions={back} /><p className="notice">This checklist has no items yet.</p></div>;
  }

  const canAnswer = data.can_answer;
  const answered = items.filter((i) => data.responses[i.id]?.answer).length;
  const go = (n: number) => { setIndex(Math.max(0, Math.min(items.length - 1, n))); requestAnimationFrame(() => heading.current?.focus()); };
  const nextOpen = () => {
    for (let k = 1; k <= items.length; k++) {
      const n = (index + k) % items.length;
      if (!data.responses[items[n].id]?.answer) return n;
    }
    return -1;
  };
  const save = async (body: Record<string, unknown>, advance: boolean) => {
    if (!item) return;
    setSaving(true);
    try {
      await api.put(url, { item_id: item.id, ...body });
      reload();
      if (advance && index < items.length - 1) go(index + 1);
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  };
  const answer = (a: 'yes' | 'no' | 'na') => {
    // A "no" usually needs a note or a photo: stay on the item so they can be added.
    void save({ answer: a, ...(note !== (response?.note ?? '') ? { note } : {}) }, a !== 'no' && !(item?.photo_required && a !== 'na'));
  };
  const addPhoto = async (file: File) => {
    const mod = loadUploader();
    if (!mod || !item) return;
    try {
      const up = await mod;
      const config = await api.get<{ maxBytes: number; allowedExtensions: string[] }>('/api/attachments/config').catch(() => undefined);
      const refusal = up.refusalFor(file, config);
      if (refusal) { toast.error(refusal); return; }
      setUploading(0);
      const att = await up.uploadFile(file, { record_type: 'inspection', record_id: ins.id, kind: 'file', description: `Photo: ${item.prompt}`.slice(0, 200) }, (f) => setUploading(Math.round(f * 100)));
      await api.put(url, { item_id: item.id, answer: response?.answer ?? null, attachment_ids: [...(response?.attachment_ids ?? []), att.id] });
      toast.success('Photo added.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setUploading(null); }
  };
  const complete = async () => {
    setSaving(true);
    try {
      const res = await api.post<{ inspection: { result: string; score_pct: number | null }; findings: { id: string; ref: string; title: string }[] }>(
        `/api/inspections/${ins.id}/complete`, { raise_findings: raise });
      setDone({ result: res.inspection.result, score_pct: res.inspection.score_pct, findings: res.findings });
      setConfirm(false);
      toast.success('Inspection completed.');
    } catch (err) { toast.error(errorMessage(err)); setConfirm(false); } finally { setSaving(false); }
  };
  const photos = response?.attachment_ids?.length ?? 0;
  const following = nextOpen();

  return (
    <div className="stack au-run">
      <PageHeader title={ins.title} reference={ins.ref} subtitle={ins.target_label ?? undefined} actions={back} />
      <ProgressBar label="Items answered" value={answered} max={items.length} valueText={`${answered} of ${items.length} answered`} color={answered === items.length ? 'green' : 'blue'} />
      {item && (
        <section className="au-run-card" aria-labelledby="au-run-item">
          <p className="au-run-count muted">Item {index + 1} of {items.length}{item.section ? ` · ${item.section}` : ''}</p>
          <h2 id="au-run-item" className="au-run-prompt" tabIndex={-1} ref={heading}>{item.prompt}</h2>
          <ItemFlags item={item} />
          {item.guidance && <p className="muted au-run-guidance">{item.guidance}</p>}
          <AnswerButtons large value={response?.answer} label={`Answer: ${item.prompt}`} disabled={!canAnswer || saving} onAnswer={answer} />
          <TextArea label={response?.answer === 'no' ? 'What was found' : 'Note (optional)'} value={note} onChange={setNote} rows={2} disabled={!canAnswer} />
          {canAnswer && note !== (response?.note ?? '') && (
            <Button size="sm" onClick={() => save({ answer: response?.answer ?? null, note }, false)} loading={saving}>Save note</Button>
          )}
          {uploadAvailable && canAnswer && (
            <div className="au-run-photo">
              <input ref={fileInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPhoto(f); }} />
              <Button icon="upload" loading={uploading !== null} onClick={() => fileInput.current?.click()}>
                {uploading !== null ? `Uploading ${uploading}%` : 'Add a photo'}
              </Button>
              <span className="muted">{photos ? `${photos} photo${photos === 1 ? '' : 's'} added` : item.photo_required ? 'A photo is needed unless not applicable.' : ''}</span>
            </div>
          )}
          {photos > 0 && !uploadAvailable && <Badge color="blue">{photos} photo{photos === 1 ? '' : 's'}</Badge>}
        </section>
      )}
      <nav className="au-run-nav" aria-label="Move between items">
        <Button icon="chevron-left" disabled={index === 0} onClick={() => go(index - 1)}>Previous</Button>
        {following >= 0
          ? <Button onClick={() => go(following)}>Next unanswered</Button>
          : canAnswer && <Button variant="primary" icon="check" onClick={() => setConfirm(true)}>Complete inspection</Button>}
        <Button icon="chevron-right" disabled={index === items.length - 1} onClick={() => go(index + 1)}>Next</Button>
      </nav>
      <ConfirmDialog open={confirm} title="Complete the inspection?" busy={saving} confirmLabel="Complete"
        message={(
          <div className="stack">
            <p>The result and score are worked out from the answers, and the answers can no longer be changed.</p>
            <Checkbox label="Raise a finding for each item not met" checked={raise} onChange={setRaise} />
          </div>
        )}
        onConfirm={complete} onCancel={() => setConfirm(false)} />
    </div>
  );
}
