import {
  Badge, Button, cx, DateTimeField, EmptyState, Icon, IconButton, LookupChip, RecordPicker, TextArea, TextField, UserPicker,
  type IconName,
} from '../../core';
import { Banner, ConflictList, TextBlock } from './bits';
import type { ApprovalRule, Conflict, Template } from './types';
import { plural } from './util';

export interface Picked { id: string; label: string }

/** Everything the "New change" flow collects. */
export interface Draft {
  type: '' | 'standard' | 'normal' | 'emergency';
  templateId: string;
  title: string;
  description: string;
  reason: string;
  system: Picked | null;
  extraSystems: Picked[];
  assignee: Picked | null;
  answers: Record<string, string>;
  implementation_plan: string;
  test_plan: string;
  backout_plan: string;
  planned_start: string;
  planned_end: string;
}

export const EMPTY_DRAFT: Draft = {
  type: '', templateId: '', title: '', description: '', reason: '', system: null, extraSystems: [], assignee: null, answers: {},
  implementation_plan: '', test_plan: '', backout_plan: '', planned_start: '', planned_end: '',
};

export interface StepProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  errors: Record<string, string>;
}

const TYPES: { value: Draft['type']; label: string; icon: IconName; text: string }[] = [
  { value: 'standard', label: 'Standard', icon: 'clipboard', text: 'Routine, low-risk work done the same way every time. Raised from a pre-approved template, so it needs no further approval.' },
  { value: 'normal', label: 'Normal', icon: 'calendar', text: 'Planned work. You assess the risk, and the change is approved before it is scheduled.' },
  { value: 'emergency', label: 'Emergency', icon: 'alert', text: 'Urgent work to restore a service or prevent harm. It proceeds with one approver and is always reviewed afterwards.' },
];

export function TypeStep({ draft, set, templates }: StepProps & { templates: Template[] }) {
  return (
    <div className="chg-choices" role="group" aria-label="Type of change">
      {TYPES.map((t) => {
        const none = t.value === 'standard' && templates.length === 0;
        return (
          <button
            key={t.value}
            type="button"
            className={cx('chg-choice', draft.type === t.value && 'chg-choice-on')}
            aria-pressed={draft.type === t.value}
            disabled={none}
            onClick={() => set({ type: t.value })}
          >
            <span className="chg-choice-head"><Icon name={t.icon} /> {t.label}</span>
            <span className="chg-choice-text">{t.text}</span>
            {none && <span className="chg-choice-text"><em>No templates have been set up yet.</em></span>}
          </button>
        );
      })}
    </div>
  );
}

export function TemplateStep({ draft, set, errors, templates }: StepProps & { templates: Template[] }) {
  if (!templates.length) {
    return <EmptyState icon="clipboard" title="No templates" message="An administrator can add standard change templates in Change settings." />;
  }
  const chosen = templates.find((t) => t.id === draft.templateId);
  return (
    <div className="stack">
      <div className="chg-choices" role="group" aria-label="Template">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={cx('chg-choice', draft.templateId === t.id && 'chg-choice-on')}
            aria-pressed={draft.templateId === t.id}
            onClick={() => set({
              templateId: t.id, title: t.title, description: t.description ?? '',
              system: t.system_id ? { id: t.system_id, label: t.system_label ?? 'System' } : draft.system,
            })}
          >
            <span className="chg-choice-head">{t.name}</span>
            {t.summary && <span className="chg-choice-text">{t.summary}</span>}
            <span className="row"><LookupChip list="change_risk" value={t.risk_level} /><Badge>About {t.duration_minutes} minutes</Badge></span>
          </button>
        ))}
      </div>
      {errors.templateId && <p className="form-error" role="alert">{errors.templateId}</p>}
      {chosen && (
        <div className="form">
          <div className="form-grid">
            <TextField className="form-cell-wide" label="Title" required value={draft.title} onChange={(title) => set({ title })} error={errors.title} />
            <SystemField draft={draft} set={set} />
            <UserPicker label="Implementer" value={draft.assignee?.id ?? null} display={draft.assignee?.label} onChange={(id, o) => set({ assignee: id ? { id, label: o?.label ?? '' } : null })} />
          </div>
          <div className="grid-2">
            <TextBlock label="Implementation plan" value={chosen.implementation_plan} />
            <TextBlock label="Back-out plan" value={chosen.backout_plan} />
          </div>
        </div>
      )}
    </div>
  );
}

function SystemField({ draft, set }: Pick<StepProps, 'draft' | 'set'>) {
  return (
    <RecordPicker
      label="Main system"
      type="system"
      value={draft.system?.id ?? null}
      display={draft.system?.label}
      onChange={(id, o) => set({ system: id ? { id, label: o?.label ?? '' } : null })}
      hint="The system this change mostly touches."
    />
  );
}

export function DetailsStep({ draft, set, errors, hasSystems }: StepProps & { hasSystems: boolean }) {
  return (
    <div className="form">
      <TextField label="Title" required value={draft.title} onChange={(title) => set({ title })} error={errors.title} autoFocus />
      <TextArea label="What will be done" value={draft.description} onChange={(description) => set({ description })} rows={3} error={errors.description} />
      <TextArea label="Why it is needed" value={draft.reason} onChange={(reason) => set({ reason })} rows={3} error={errors.reason} />
      <div className="form-grid">
        {hasSystems && <SystemField draft={draft} set={set} />}
        <UserPicker label="Implementer" value={draft.assignee?.id ?? null} display={draft.assignee?.label} onChange={(id, o) => set({ assignee: id ? { id, label: o?.label ?? '' } : null })} hint="Who will carry out the work." />
      </div>
      {hasSystems && (
        <fieldset className="chg-fieldset">
          <legend>Other affected systems</legend>
          {draft.extraSystems.length > 0 && (
            <ul className="chg-picked">
              {draft.extraSystems.map((s) => (
                <li key={s.id}>
                  {s.label}
                  <IconButton icon="x" size="sm" variant="ghost" label={`Remove ${s.label}`} onClick={() => set({ extraSystems: draft.extraSystems.filter((x) => x.id !== s.id) })} />
                </li>
              ))}
            </ul>
          )}
          <RecordPicker
            key={draft.extraSystems.length}
            label="Add a system"
            type="system"
            value={null}
            placeholder="Search systems…"
            onChange={(id, o) => {
              if (id && id !== draft.system?.id && !draft.extraSystems.some((s) => s.id === id)) set({ extraSystems: [...draft.extraSystems, { id, label: o?.label ?? 'System' }] });
            }}
          />
        </fieldset>
      )}
    </div>
  );
}

export function PlansStep({ draft, set, errors }: StepProps) {
  return (
    <div className="form">
      <TextArea label="Implementation plan" value={draft.implementation_plan} onChange={(implementation_plan) => set({ implementation_plan })} rows={5} error={errors.implementation_plan} hint="The steps, in order, and who does each." />
      <TextArea label="Test plan" value={draft.test_plan} onChange={(test_plan) => set({ test_plan })} rows={3} hint="How you will know it worked." />
      <TextArea label="Back-out plan" value={draft.backout_plan} onChange={(backout_plan) => set({ backout_plan })} rows={4} error={errors.backout_plan} hint="How to put things back if it goes wrong, and when you will decide to." />
    </div>
  );
}

interface ScheduleProps extends StepProps {
  conflicts: Conflict[] | undefined;
  checking: boolean;
  rule: ApprovalRule | undefined;
  riskLevel: string | null;
  missing: string[];
}

export function ScheduleStep({ draft, set, errors, conflicts, checking, rule, riskLevel, missing }: ScheduleProps) {
  const window = Boolean(draft.planned_start && draft.planned_end);
  return (
    <div className="form">
      <div className="form-grid">
        <DateTimeField
          label="Planned start"
          value={draft.planned_start}
          error={errors.planned_start}
          onChange={(planned_start) => set({
            planned_start,
            // A new start keeps the length of the window, or gives it an hour.
            planned_end: planned_start && (!draft.planned_end || new Date(draft.planned_end) <= new Date(planned_start))
              ? new Date(new Date(planned_start).getTime() + 3600000).toISOString() : draft.planned_end,
          })}
        />
        <DateTimeField label="Planned end" value={draft.planned_end} error={errors.planned_end} onChange={(planned_end) => set({ planned_end })} />
      </div>

      <section aria-live="polite" className="stack">
        <h3 className="chg-subhead">Conflicts</h3>
        {!window ? <p className="muted">Enter the planned start and end to check for blackout periods and other changes.</p>
          : conflicts === undefined ? <p className="muted">Checking…</p>
          : conflicts.length === 0 ? <Banner tone="success">No conflicts: the window is clear of blackout periods and of other changes to the same systems.{checking ? ' Checking again…' : ''}</Banner>
          : (
            <>
              <Banner tone="warn">
                {plural(conflicts.length, 'conflict')} found. You can still create the change, but it cannot be scheduled until
                the window is moved or someone with the Approve permission acknowledges the conflict.
              </Banner>
              <ConflictList conflicts={conflicts} />
            </>
          )}
      </section>

      <section className="stack">
        <h3 className="chg-subhead">What happens next</h3>
        {draft.type === 'standard' ? (
          <Banner tone="success">A standard change is pre-approved. It will be created ready to schedule.</Banner>
        ) : (
          <Banner>
            {riskLevel
              ? <>At <strong>{riskLevel}</strong> risk this {draft.type} change needs {plural(rule?.approvals ?? 1, 'approval')}{rule?.approver_roles.length ? <> ({rule.approver_roles.join(', ')})</> : null}.</>
              : <>The approvals needed depend on the risk level; finish the risk questions to see them.</>}
            {(draft.type === 'emergency' || rule?.pir_required) && ' A post-implementation review will be required before it is closed.'}
          </Banner>
        )}
        {missing.length > 0 && draft.type !== 'standard' && (
          <Banner tone="warn">
            To submit for approval you still need: {missing.join(', ')}. You can save the change as a draft and finish it later.
          </Banner>
        )}
      </section>
    </div>
  );
}

export function StepNav({ onBack, onNext, nextLabel = 'Next', children }: { onBack?: () => void; onNext?: () => void; nextLabel?: string; children?: React.ReactNode }) {
  return (
    <div className="form-actions chg-stepnav">
      {onBack && <Button icon="chevron-left" onClick={onBack}>Back</Button>}
      {children}
      {onNext && <Button variant="primary" onClick={onNext}>{nextLabel}</Button>}
    </div>
  );
}
