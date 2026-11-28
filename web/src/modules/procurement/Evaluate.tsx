// A committee member's own pages: the evaluations they sit on, and one evaluation where they declare any
// conflict of interest and score each offer. No procurement role is needed: being on the committee is.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, LookupChip, Notice, NumberField, PageHeader,
  TableWrap, TextArea, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { money } from './shared';

interface MineRow { id: string; ref: string; title: string; status: string; proposals_due_at: string | null; awarded_on: string | null; role: string; coi_status: string; submitted_at: string | null; offers: number; criteria: number; scored: number }

export function MyEvaluations() {
  const { data, error, reload } = useFetch<MineRow[]>('/api/procurement/my-evaluations');
  return (
    <div className="stack">
      <PageHeader title="My evaluations" subtitle="Solicitations whose evaluation committee you sit on." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} />
        : data.length === 0 ? <EmptyState icon="scale" title="You are not on any evaluation committee" message="When a buyer adds you to a committee, the evaluation appears here and in My work." /> : (
          <Card flush>
            <TableWrap label="My evaluations"><table className="table">
              <thead><tr><th scope="col">Solicitation</th><th scope="col">Offers due</th><th scope="col">My scores</th><th scope="col">Status</th></tr></thead>
              <tbody>{data.map((r) => (
                <tr key={r.id}>
                  <td><Link className="row-title" to={`/procurement/evaluate/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link></td>
                  <td>{r.proposals_due_at ? formatDateTime(r.proposals_due_at) : '—'}</td>
                  <td>{r.coi_status === 'conflict' ? 'Conflict declared' : r.submitted_at ? `Handed in ${formatDate(r.submitted_at)}` : `${r.scored} of ${r.offers * r.criteria}`}</td>
                  <td><LookupChip list="procurement_status" value={r.status} /></td>
                </tr>
              ))}</tbody>
            </table></TableWrap>
          </Card>
        )}
    </div>
  );
}

interface Page {
  procurement: { id: string; ref: string; title: string; description: string | null; method: string; status: string; proposals_due_at: string | null; awarded: boolean };
  me: { role: string; coi_status: string; coi_note: string | null; coi_declared_at: string | null; submitted_at: string | null };
  criteria: { id: string; name: string; description: string | null; weight: number; max_score: number }[];
  offers: { id: string; ref: string | null; bidder_name: string; amount: number | null; received_at: string | null; status: string | null }[];
  scores: { offer_id: string; criterion_id: string; score: number; comment: string | null }[];
}

const key = (o: string, c: string) => `${o}:${c}`;

function Declaration({ id, onSaved }: { id: string; onSaved: () => void }) {
  const toast = useToast();
  const [conflict, setConflict] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/procurement/my-evaluations/${id}/declaration`, { conflict, note });
      toast.success('Declaration recorded.'); onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Conflict of interest">
      <div className="stack">
        <p>Before you see the offers, declare whether you, a family member or a business you are connected with has an interest in any bidder.</p>
        <fieldset className="prc-choice">
          <legend className="sr-only">Do you have a conflict of interest?</legend>
          <label><input type="radio" name="coi" checked={conflict === false} onChange={() => setConflict(false)} /> I have no conflict of interest</label>
          <label><input type="radio" name="coi" checked={conflict === true} onChange={() => setConflict(true)} /> I have a conflict of interest</label>
        </fieldset>
        {conflict && <TextArea label="Describe the conflict" required value={note} rows={3} onChange={setNote} />}
        <div><Button variant="primary" loading={busy} disabled={conflict === null || (conflict && !note.trim())} onClick={save}>Record my declaration</Button></div>
      </div>
    </Card>
  );
}

export function EvaluatePage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { data, error, reload } = useFetch<Page>(`/api/procurement/my-evaluations/${id}`);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsaved = useUnsavedChanges(dirty);

  useEffect(() => {
    if (!data) return;
    setValues(Object.fromEntries(data.scores.map((s) => [key(s.offer_id, s.criterion_id), Number(s.score)])));
    setComments(Object.fromEntries(data.scores.map((s) => [key(s.offer_id, s.criterion_id), s.comment ?? ''])));
    setDirty(false);
  }, [data]);

  const needed = data ? data.offers.length * data.criteria.length : 0;
  const filled = useMemo(() => Object.values(values).filter((v) => v !== null && v !== undefined).length, [values]);
  const save = async (submit: boolean) => {
    if (!data) return;
    setBusy(true);
    try {
      const scores = data.offers.flatMap((o) => data.criteria.map((c) => ({
        offer_id: o.id, criterion_id: c.id, score: values[key(o.id, c.id)] ?? null, comment: comments[key(o.id, c.id)] || null,
      })));
      await api.put(`/api/procurement/my-evaluations/${id}/scores`, { scores, submit });
      unsaved.release();
      toast.success(submit ? 'Scores handed in.' : 'Scores saved.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  if (error) return <div className="stack"><PageHeader title="Evaluation" /><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack"><PageHeader title="Evaluation" /><Loading lines={8} /></div>;
  const p = data.procurement;
  const locked = Boolean(data.me.submitted_at) || p.awarded || ['canceled', 'closed'].includes(p.status);
  const advisor = data.me.role === 'advisor';
  return (
    <div className="stack">
      <PageHeader title={`Evaluate: ${p.title}`} reference={p.ref} subtitle={`${p.method}${p.proposals_due_at ? ` · offers were due ${formatDateTime(p.proposals_due_at)}` : ''}`}
        breadcrumbs={[{ label: 'My evaluations', to: '/procurement/evaluations' }, { label: p.ref }]} />
      {p.description && <Card title="Scope of work"><p className="prc-pre">{p.description}</p></Card>}
      {data.me.coi_status === 'pending' && !locked ? <Declaration id={id} onSaved={reload} />
        : data.me.coi_status === 'conflict' ? (
          <Notice tone="warning" title="You declared a conflict of interest">You do not see or score the offers of this evaluation. {data.me.coi_note}</Notice>
        ) : advisor ? (
          <Notice title="You advise the committee">Advisors read the offers but do not score them.</Notice>
        ) : null}
      {data.me.coi_status !== 'conflict' && (data.me.coi_status === 'none' || locked) && (
        <Card title="Scores" flush>
          <div className="prc-pad">
            {data.me.submitted_at ? <Notice tone="success" title="Handed in">You handed in your scores on {formatDate(data.me.submitted_at)}. Ask the buyer to reopen them to make a change.</Notice>
              : p.awarded ? <Notice title="Awarded">This solicitation is awarded; scores can no longer change.</Notice>
              : <p className="muted">Score each offer from 0 to the top score of each criterion, on your own. {filled} of {needed} scored.</p>}
          </div>
          {data.criteria.length === 0 || data.offers.length === 0 ? (
            <EmptyState icon="scale" title="Nothing to score yet" message={data.criteria.length === 0 ? 'The buyer has not set the criteria yet.' : 'No offers have been recorded yet.'} />
          ) : data.offers.map((o) => (
            <section key={o.id} className="prc-offer">
              <h3 className="prc-offer-head">{o.ref && <span className="ref">{o.ref}</span>} {o.bidder_name} <span className="muted">· {money(o.amount)}</span></h3>
              <TableWrap label={`Scores for ${o.bidder_name}`}><table className="table prc-wrap">
                <thead><tr><th scope="col">Criterion</th><th scope="col" className="num">Weight</th><th scope="col">Score</th><th scope="col">Comment</th></tr></thead>
                <tbody>{data.criteria.map((c) => {
                  const k = key(o.id, c.id);
                  return (
                    <tr key={c.id}>
                      <td>{c.name}{c.description && <div className="muted prc-small">{c.description}</div>}</td>
                      <td className="num">{Number(c.weight)}</td>
                      <td className="prc-score">
                        <NumberField label={`Score for ${c.name}, ${o.bidder_name} (0 to ${Number(c.max_score)})`} hideLabel min={0} max={Number(c.max_score)} disabled={locked || advisor}
                          value={values[k] ?? null} onChange={(v) => { setDirty(true); setValues((x) => ({ ...x, [k]: v })); }} />
                        <span className="muted prc-small">of {Number(c.max_score)}</span>
                      </td>
                      <td><TextArea label={`Comment on ${c.name}, ${o.bidder_name}`} hideLabel rows={1} maxRows={4} value={comments[k] ?? ''} disabled={locked || advisor}
                        onChange={(v) => { setDirty(true); setComments((x) => ({ ...x, [k]: v })); }} /></td>
                    </tr>
                  );
                })}</tbody>
              </table></TableWrap>
            </section>
          ))}
          {!locked && !advisor && needed > 0 && (
            <div className="prc-pad prc-buttons">
              <Button loading={busy} disabled={!dirty} onClick={() => save(false)}>Save for later</Button>
              <Button variant="primary" loading={busy} disabled={filled < needed} onClick={() => save(true)}>Hand in my scores</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
