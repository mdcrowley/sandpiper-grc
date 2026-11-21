import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, errorMessage, ErrorState, Loading, lookupLabel, PageHeader, Stepper, useCustomFieldInputs, useDebounced, useFetch, useResource,
  useToast, useUnsavedChanges, type Row,
} from '../../core';
import { RiskQuestions, RiskResult } from './bits';
import {
  DetailsStep, EMPTY_DRAFT, PlansStep, ScheduleStep, StepNav, TemplateStep, TypeStep, type Draft,
} from './NewChangeSteps';
import type { ChangeSettings, Conflict, Template } from './types';
import { computeRisk, matchRule } from './util';

const STEPS_STANDARD = [{ key: 'type', label: 'Type' }, { key: 'template', label: 'Template' }, { key: 'schedule', label: 'Schedule' }];
const STEPS_OTHER = [
  { key: 'type', label: 'Type' }, { key: 'details', label: 'Details' }, { key: 'risk', label: 'Risk' },
  { key: 'plans', label: 'Plans' }, { key: 'schedule', label: 'Schedule' },
];

/** Guided flow for raising a change: type, template or details, risk, plans, then the schedule with live conflict warnings. */
export function NewChange() {
  const navigate = useNavigate();
  const toast = useToast();
  const hasSystems = Boolean(useResource('system'));
  const settings = useFetch<ChangeSettings>('/api/changes/settings');
  const templates = useFetch<Template[]>('/api/changes/templates');
  // A window can be passed in the address (the calendar's New change does this): ?start=<ISO>&end=<ISO>.
  const [search] = useSearchParams();
  const [startDraft] = useState<Draft>(() => {
    const valid = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');
    const start = valid(search.get('start'));
    const end = valid(search.get('end'));
    return { ...EMPTY_DRAFT, planned_start: start, planned_end: end && start && end > start ? end : '' };
  });
  const [draft, setDraft] = useState<Draft>(startDraft);
  // Leaving with a half-filled change asks first (BW-01).
  const unsaved = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(startDraft));
  const [step, setStep] = useState('type');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[] | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  // The administrator's custom fields on changes (E18-34): asked with the details, or under the
  // chosen template for a standard change.
  const custom = useCustomFieldInputs('change');
  const customStep = draft.type === 'standard' ? 'template' : 'details';

  const set = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setErrors({}); setFormError(''); };
  const steps = draft.type === 'standard' ? STEPS_STANDARD : STEPS_OTHER;
  const index = Math.max(0, steps.findIndex((s) => s.key === step));

  const q = settings.data?.questionnaire;
  const template = templates.data?.find((t) => t.id === draft.templateId);
  const preview = useMemo(() => (q ? computeRisk(draft.answers, q) : undefined), [draft.answers, q]);
  const riskLevel = draft.type === 'standard' ? template?.risk_level ?? null : preview?.level ?? null;
  const rule = settings.data && draft.type ? matchRule(settings.data.approval_rules, draft.type, riskLevel) : undefined;

  // Live conflict check: runs a moment after the window or the systems change.
  const systemIds = useMemo(() => [draft.system?.id, ...draft.extraSystems.map((s) => s.id)].filter(Boolean) as string[], [draft.system, draft.extraSystems]);
  const probe = useDebounced(JSON.stringify({ planned_start: draft.planned_start, planned_end: draft.planned_end, system_ids: systemIds }), 400);
  useEffect(() => {
    const body = JSON.parse(probe) as { planned_start: string; planned_end: string };
    if (!body.planned_start || !body.planned_end) { setConflicts(undefined); return; }
    let stale = false;
    setChecking(true);
    api.post<{ conflicts: Conflict[] }>('/api/changes/conflicts/check', body).then(
      (res) => { if (!stale) { setConflicts(res.conflicts); setChecking(false); } },
      () => { if (!stale) { setConflicts([]); setChecking(false); } },
    );
    return () => { stale = true; };
  }, [probe]);

  const header = (
    <PageHeader
      title="New change"
      subtitle="Describe the change, assess its risk and choose when it will happen."
      breadcrumbs={[{ label: 'Changes', to: '/changes' }, { label: 'New change' }]}
    />
  );
  const error = settings.error ?? templates.error;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={() => { settings.reload(); templates.reload(); }} /></div>;
  if (!settings.data || !templates.data || !q) return <div className="stack">{header}<Loading lines={6} /></div>;

  /** What a submission still lacks, in the user's words. */
  const missing = [
    !draft.description.trim() && 'what will be done',
    !draft.reason.trim() && 'why it is needed',
    !preview?.complete && 'answers to every risk question',
    !draft.implementation_plan.trim() && 'an implementation plan',
    !draft.backout_plan.trim() && 'a back-out plan',
    (!draft.planned_start || !draft.planned_end) && 'the planned start and end',
  ].filter(Boolean) as string[];

  function check(key: string): boolean {
    const e: Record<string, string> = {};
    if (key === 'type' && !draft.type) e.type = 'Choose the type of change.';
    if (key === 'template' && !draft.templateId) e.templateId = 'Choose a template.';
    if ((key === 'template' || key === 'details') && !draft.title.trim()) e.title = 'Title is required.';
    if (key === 'schedule') {
      if (draft.type === 'standard' && !draft.planned_start) e.planned_start = 'Enter the planned start.';
      if (draft.planned_start && draft.planned_end && new Date(draft.planned_end) <= new Date(draft.planned_start)) e.planned_end = 'The planned end must be after the planned start.';
    }
    setErrors(e);
    const customOk = key !== customStep || custom.collect() !== null;
    return Object.keys(e).length === 0 && customOk;
  }

  const go = (to: number) => {
    if (to > index && !check(steps[index].key)) return;
    setErrors({});
    setStep(steps[Math.min(Math.max(to, 0), steps.length - 1)].key);
  };

  async function create(submit: boolean) {
    if (!check('schedule')) return;
    const extra = custom.collect();
    if (!extra) {
      // A required custom field is empty: back to the step that asks it, where it is marked.
      setStep(customStep);
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    setFormError('');
    let created: Row | undefined;
    try {
      if (draft.type === 'standard') {
        created = await api.post<Row>(`/api/changes/templates/${draft.templateId}/raise`, {
          title: draft.title, planned_start: draft.planned_start, planned_end: draft.planned_end || undefined,
          system_id: draft.system?.id, assignee_id: draft.assignee?.id, ...extra,
        });
      } else {
        created = await api.post<Row>('/api/changes', {
          title: draft.title, description: draft.description, reason: draft.reason, change_type: draft.type,
          system_id: draft.system?.id, assignee_id: draft.assignee?.id, risk_answers: draft.answers,
          implementation_plan: draft.implementation_plan, test_plan: draft.test_plan, backout_plan: draft.backout_plan,
          planned_start: draft.planned_start || undefined, planned_end: draft.planned_end || undefined, ...extra,
        });
      }
      for (const s of draft.extraSystems) {
        await api.post('/api/links', { from_type: 'change', from_id: created.id, to_type: 'system', to_id: s.id, relation: 'affects' });
      }
      if (submit && draft.type !== 'standard') await api.post(`/api/changes/${created.id}/transition`, { to: 'submitted' });
      toast.success(draft.type === 'standard' ? `${created.ref} created. It is pre-approved.` : submit ? `${created.ref} submitted for approval.` : `${created.ref} saved as a draft.`);
      unsaved.release();
      navigate(`/changes/${created.id}`);
    } catch (err) {
      if (created) {
        // The change exists; only a later step failed. Show it rather than risk a duplicate.
        toast.error(`${created.ref} was created, but: ${errorMessage(err)}`);
        unsaved.release();
        navigate(`/changes/${created.id}`);
        return;
      }
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        if (custom.showErrors(err.fields)) setStep(customStep);
      }
      setFormError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const props = { draft, set, errors };
  const typeName = draft.type ? lookupLabel('change_type', draft.type) : '';
  return (
    <div className="stack chg-narrow">
      {header}
      <Stepper label="Steps" steps={steps} current={steps[index].key} onStepClick={(key) => go(steps.findIndex((s) => s.key === key))} />

      {step === 'type' && (
        <Card title="What type of change is this?">
          <TypeStep {...props} templates={templates.data} />
          {errors.type && <p className="form-error" role="alert">{errors.type}</p>}
          <StepNav onNext={() => go(1)} />
        </Card>
      )}

      {step === 'template' && (
        <Card title="Choose a template">
          <TemplateStep {...props} templates={templates.data} />
          {draft.templateId && custom.inputs}
          <StepNav onBack={() => go(index - 1)} onNext={() => go(index + 1)} />
        </Card>
      )}

      {step === 'details' && (
        <Card title={`${typeName} change: details`}>
          <DetailsStep {...props} hasSystems={hasSystems} />
          {custom.inputs}
          <StepNav onBack={() => go(index - 1)} onNext={() => go(index + 1)} />
        </Card>
      )}

      {step === 'risk' && preview && (
        <Card title="Risk questionnaire">
          <div className="form">
            <p className="muted">Your answers give the change a risk level, which decides how much approval it needs.</p>
            <RiskQuestions questionnaire={q} answers={draft.answers} onChange={(answers) => set({ answers })} />
            <RiskResult preview={preview} total={q.questions.length} />
            {errors.risk_answers && <p className="form-error" role="alert">{errors.risk_answers}</p>}
          </div>
          <StepNav onBack={() => go(index - 1)} onNext={() => go(index + 1)} />
        </Card>
      )}

      {step === 'plans' && (
        <Card title="Plans">
          <PlansStep {...props} />
          <StepNav onBack={() => go(index - 1)} onNext={() => go(index + 1)} />
        </Card>
      )}

      {step === 'schedule' && (
        <Card title="Schedule">
          <ScheduleStep {...props} conflicts={conflicts} checking={checking} rule={rule} riskLevel={riskLevel ? lookupLabel('change_risk', riskLevel).toLowerCase() : null} missing={missing} />
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <StepNav onBack={() => go(index - 1)}>
            {draft.type === 'standard' ? (
              <Button variant="primary" loading={busy === 'submit'} onClick={() => void create(true)}>Create change</Button>
            ) : (
              <>
                <Button loading={busy === 'draft'} disabled={busy !== ''} onClick={() => void create(false)}>Save as draft</Button>
                <Button variant="primary" loading={busy === 'submit'} disabled={missing.length > 0 || busy === 'draft'} onClick={() => void create(true)}>Create and submit</Button>
              </>
            )}
          </StepNav>
        </Card>
      )}
    </div>
  );
}
