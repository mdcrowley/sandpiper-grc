import { useEffect, useState } from 'react';
import { api, ApiError, Button, Card, Checkbox, errorMessage, IconButton, NumberField, TextField, useAuth, useLookup, useToast } from '../../core';
import type { ChangeSettings, Questionnaire, RiskQuestion } from './types';

/** The risk questionnaire: questions, weights, the score of each answer, and where each risk level ends. */
export function QuestionnaireAdmin({ settings, onSaved }: { settings: ChangeSettings; onSaved: () => void }) {
  const toast = useToast();
  const risks = useLookup('change_risk');
  const { areaOn } = useAuth();
  const [questions, setQuestions] = useState<RiskQuestion[]>([]);
  const [bands, setBands] = useState<Record<string, number | null>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQuestions(settings.questionnaire.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) })));
    setBands(Object.fromEntries(settings.questionnaire.bands.map((b) => [b.level, b.upTo])));
  }, [settings]);

  const setQuestion = (i: number, patch: Partial<RiskQuestion>) => setQuestions((list) => list.map((q, n) => (n === i ? { ...q, ...patch } : q)));
  const setOption = (i: number, j: number, patch: Partial<RiskQuestion['options'][number]>) =>
    setQuestion(i, { options: questions[i].options.map((o, n) => (n === j ? { ...o, ...patch } : o)) });
  const totalWeight = questions.reduce((n, q) => n + (Number(q.weight) > 0 ? Number(q.weight) : 0), 0);
  const last = risks[risks.length - 1]?.value;

  async function save() {
    setBusy(true);
    setFields({});
    const body: Questionnaire = {
      questions,
      bands: risks.map((r) => ({ level: r.value, upTo: r.value === last ? 100 : Number(bands[r.value] ?? NaN) })),
    };
    try {
      const res = await api.patch<ChangeSettings>('/api/changes/settings', { questionnaire: body });
      toast.success(res.recalculated ? `Saved. ${res.recalculated} draft ${res.recalculated === 1 ? 'change was' : 'changes were'} rescored.` : 'Saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card title="Risk levels">
        <div className="form">
          <p className="muted">
            The answers give a score from 0 to 100: each answer's score is multiplied by the weight of its question, and the total is
            taken as a share of the highest possible. Set the score at which each level ends; the highest level runs to 100.
          </p>
          <div className="form-grid">
            {risks.filter((r) => r.value !== last).map((r) => (
              <NumberField key={r.value} label={`${r.label} up to`} min={0} max={100} step={1} value={bands[r.value] ?? null} onChange={(n) => setBands({ ...bands, [r.value]: n })} error={fields[`bands.${r.value}`]} />
            ))}
          </div>
          {fields.bands && <p className="form-error" role="alert">{fields.bands}</p>}
        </div>
      </Card>

      <Card title="Questions">
        <div className="form">
          <p className="muted">Changing the questions rescores drafts at once. Changes already submitted keep the level they were approved at.</p>
          {questions.map((q, i) => (
            <fieldset key={i} className="chg-fieldset">
              <legend>Question {i + 1}</legend>
              <div className="chg-question-row">
                <TextField label="Question" value={q.label} onChange={(label) => setQuestion(i, { label })} error={fields[`questions.${i}.label`]} />
                <NumberField
                  label="Weight"
                  min={0}
                  max={100}
                  value={q.weight}
                  onChange={(weight) => setQuestion(i, { weight: weight ?? 0 })}
                  error={fields[`questions.${i}.weight`]}
                  hint={totalWeight && q.weight > 0 ? `${Math.round((q.weight / totalWeight) * 100)}% of the score` : undefined}
                />
                <IconButton icon="trash" variant="ghost" label={`Remove question ${i + 1}`} onClick={() => setQuestions((list) => list.filter((_, n) => n !== i))} />
              </div>
              <TextField label="Help text" value={q.help ?? ''} onChange={(help) => setQuestion(i, { help })} />
              {/* E25-11: only while safety management is on (the safety assessment it asks for lives there). */}
              {areaOn('safety') && (
                <Checkbox label="This question asks whether the change affects safety" checked={q.meta?.safety_impact === true}
                  hint="An answer scoring above zero marks the change as affecting safety: it then needs a hazard linked as its safety assessment before approval."
                  onChange={(on) => setQuestion(i, { meta: on ? { safety_impact: true } : undefined })} />
              )}
              {q.options.map((o, j) => (
                <div key={j} className="chg-option-row">
                  <TextField label={`Answer ${j + 1}`} value={o.label} onChange={(label) => setOption(i, j, { label })} error={fields[`questions.${i}.options.${j}.label`]} />
                  <NumberField label="Score" min={0} max={100} value={o.score} onChange={(score) => setOption(i, j, { score: score ?? 0 })} error={fields[`questions.${i}.options.${j}.score`]} />
                  <IconButton icon="x" variant="ghost" label={`Remove answer ${j + 1}`} onClick={() => setQuestion(i, { options: q.options.filter((_, n) => n !== j) })} />
                </div>
              ))}
              {fields[`questions.${i}.options`] && <p className="form-error" role="alert">{fields[`questions.${i}.options`]}</p>}
              <div><Button size="sm" icon="plus" onClick={() => setQuestion(i, { options: [...q.options, { value: '', label: '', score: 0 }] })}>Add answer</Button></div>
            </fieldset>
          ))}
          {fields.questions && <p className="form-error" role="alert">{fields.questions}</p>}
          <div className="form-actions">
            <Button icon="plus" onClick={() => setQuestions((list) => [...list, { key: '', label: '', weight: 1, options: [{ value: '', label: 'No', score: 0 }, { value: '', label: 'Yes', score: 3 }] }])}>Add question</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>Save questionnaire</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
