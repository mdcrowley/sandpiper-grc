// The vendor assessment questions: the set in use, edited as a list. Saving makes a new
// version; assessments already completed keep the version they were answered against.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, IconButton, Loading, PageHeader, Select,
  TableWrap, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { Question } from './Assessment';
import { ResponseLinkSettings } from './ResponseLink';

interface SetData {
  active: { id: string; version: number; title: string; questions: Question[] } | null;
  versions: { id: string; version: number; title: string; active: boolean; created_at: string; questions: number }[];
}
interface Line extends Omit<Question, 'key'> { key: string; local: number }

const WEIGHTS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Weight ${n}` }));
let nextLocal = 1;

export function AssessmentQuestions() {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('vendors.administer');
  const { data, error, reload } = useFetch<SetData>('/api/vendors/question-sets');
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setTitle(data.active?.title ?? 'Vendor security assessment');
    setLines((data.active?.questions ?? []).map((q) => ({ ...q, local: nextLocal++ })));
    setDirty(false);
  }, [data]);

  const change = (local: number, patch: Partial<Line>) => { setLines(lines.map((l) => (l.local === local ? { ...l, ...patch } : l))); setDirty(true); };
  const move = (i: number, by: number) => {
    const next = [...lines];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    setLines(next);
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.post<{ version: number }>('/api/vendors/question-sets', {
        title, questions: lines.map((l) => ({ key: l.key, section: l.section, text: l.text, guidance: l.guidance, weight: l.weight })),
      });
      toast.success(`Saved as version ${made.version}.`);
      reload();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={8} label="Loading the questions" />;
  else {
    const total = lines.reduce((n, l) => n + l.weight, 0);
    body = (
      <>
        <Card
          title={<>Questions in use <Badge color="blue">Version {data.active?.version ?? 0}</Badge></>}
          actions={editable && <Button size="sm" icon="plus" onClick={() => { setLines([...lines, { key: '', local: nextLocal++, section: lines[lines.length - 1]?.section ?? null, text: '', guidance: null, weight: 1 }]); setDirty(true); }}>Add question</Button>}
        >
          {editable && (
            <div className="vnd-q-title">
              <TextField label="Name of the question set" value={title} onChange={(v) => { setTitle(v); setDirty(true); }} />
            </div>
          )}
          {lines.length === 0 && <EmptyState icon="clipboard" title="No questions" message="Add at least one question before saving." />}
          <ol className="vnd-q-list">
            {lines.map((l, i) => (
              <li key={l.local} className="vnd-q">
                <span className="vnd-q-num" aria-hidden="true">{i + 1}</span>
                {editable ? (
                  <div className="vnd-q-fields">
                    <TextArea label={`Question ${i + 1}`} hideLabel rows={1} placeholder="The question, answerable with yes, partly or no" value={l.text} onChange={(text) => change(l.local, { text })} />
                    <div className="vnd-q-row">
                      <TextField label={`Section of question ${i + 1}`} hideLabel placeholder="Section (optional)" value={l.section ?? ''} onChange={(section) => change(l.local, { section: section || null })} />
                      <TextField label={`Guidance for question ${i + 1}`} hideLabel placeholder="Guidance for the person asking (optional)" value={l.guidance ?? ''} onChange={(guidance) => change(l.local, { guidance: guidance || null })} />
                      <Select label={`Weight of question ${i + 1}`} hideLabel required options={WEIGHTS} value={String(l.weight)} onChange={(w) => change(l.local, { weight: Number(w) || 1 })} />
                    </div>
                  </div>
                ) : (
                  <div className="vnd-q-fields">
                    <span>{l.text}</span>
                    {l.guidance && <span className="vnd-clause-hint">{l.guidance}</span>}
                    <span className="muted">{l.section ?? 'No section'} · weight {l.weight}</span>
                  </div>
                )}
                {editable && (
                  <span className="vnd-q-tools">
                    <IconButton icon="arrow-up" size="sm" label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon="arrow-down" size="sm" label={`Move question ${i + 1} down`} disabled={i === lines.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon="trash" size="sm" label={`Remove question ${i + 1}`} onClick={() => { setLines(lines.filter((x) => x.local !== l.local)); setDirty(true); }} />
                  </span>
                )}
              </li>
            ))}
          </ol>
          {problem && <div className="form-error" role="alert">{problem}</div>}
          <div className="form-actions vnd-q-actions">
            <span className="muted">{lines.length} questions, total weight {total}. A question's share of the score is its weight divided by the total.</span>
            {editable && dirty && <Button onClick={reload} disabled={busy}>Undo changes</Button>}
            {editable && <Button variant="primary" loading={busy} disabled={!dirty || !lines.length} onClick={() => void save()}>Save as version {(data.versions[0]?.version ?? 0) + 1}</Button>}
          </div>
        </Card>
        <Card title="Vendors answering for themselves">
          <ResponseLinkSettings />
        </Card>
        <Card title="Versions" flush>
          <TableWrap label="Versions">
            <table className="table">
              <thead><tr><th scope="col">Version</th><th scope="col">Name</th><th scope="col">Questions</th><th scope="col">Saved</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.versions.map((v) => (
                  <tr key={v.id}>
                    <th scope="row">Version {v.version}</th>
                    <td>{v.title}</td><td>{v.questions}</td><td>{formatDate(v.created_at)}</td>
                    <td>{v.active ? <Badge color="green">In use</Badge> : <Badge color="gray">Kept for history</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Assessment questions"
        subtitle="The security questions asked of every vendor. Each is answered yes, partly, no or not applicable; the weight says how much it counts toward the score."
        breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Assessment questions' }]}
        actions={<Link className="btn btn-secondary" to="/vendors">Vendors</Link>}
      />
      {!editable && data && <p className="notice">You can read the questions. Changing them needs permission to administer vendors.</p>}
      {body}
    </div>
  );
}
