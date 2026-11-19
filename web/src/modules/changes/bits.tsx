import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Radio } from '@mantine/core';
import { cx, formatDateTime, Icon, LookupChip, ProgressBar, type IconName } from '../../core';
import type { Conflict, Questionnaire } from './types';
import { plural, type RiskPreview } from './util';

/** A short message box. Tones follow the core notice styles. */
export function Banner({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: IconName; children: ReactNode }) {
  const cls = { info: '', warn: 'notice-warn-soft', danger: 'notice-warn', success: 'notice-success' }[tone];
  const fallback: IconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return (
    <div className={cx('notice chg-banner', cls)} role={tone === 'danger' ? 'alert' : 'note'}>
      <Icon name={icon ?? fallback} />
      <div className="chg-banner-body">{children}</div>
    </div>
  );
}

/** The warning list shown on a change, in the new-change flow and on the calendar. */
export function ConflictList({ conflicts, currentChangeId }: { conflicts: Conflict[]; currentChangeId?: string }) {
  return (
    <ul className="chg-conflicts">
      {conflicts.map((c) => (
        <li key={c.key} className={cx('chg-conflict', c.acknowledged ? 'chg-conflict-ok' : 'chg-conflict-open')}>
          <Icon name={c.acknowledged ? 'check' : c.kind === 'blackout' ? 'lock' : 'alert'} />
          <div>
            <p className="chg-conflict-title">
              {c.kind === 'change' && c.record.id !== currentChangeId
                ? <>Overlaps <Link to={`/changes/${c.record.id}`}>{[c.record.ref, c.record.title].filter(Boolean).join(' ')}</Link>{c.shared_systems.length > 0 && <> on {c.shared_systems.map((s) => s.label).join(', ')}</>}</>
                : c.summary}
            </p>
            <p className="muted">
              {c.kind === 'blackout' ? 'Blackout period' : 'Other change'}: {formatDateTime(c.starts_at)} to {formatDateTime(c.ends_at)}
            </p>
            {c.acknowledged && (
              <p className="chg-conflict-ack">
                Acknowledged{c.acknowledged.by ? ` by ${c.acknowledged.by}` : ''} on {formatDateTime(c.acknowledged.at)}: {c.acknowledged.reason}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface RiskQuestionsProps {
  questionnaire: Questionnaire;
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
  disabled?: boolean;
}

/** The risk questionnaire: one group of choices per question. */
export function RiskQuestions({ questionnaire, answers, onChange, disabled }: RiskQuestionsProps) {
  return (
    <div className="chg-questions">
      {questionnaire.questions.map((q, i) => (
        <Radio.Group
          key={q.key}
          label={`${i + 1}. ${q.label}`}
          description={q.help}
          value={answers[q.key] ?? ''}
          onChange={(value) => onChange({ ...answers, [q.key]: value })}
        >
          <div className="chg-options">
            {q.options.map((o) => <Radio key={o.value} value={o.value} label={o.label} disabled={disabled} />)}
          </div>
        </Radio.Group>
      ))}
    </div>
  );
}

/** The level the answers give so far. */
export function RiskResult({ preview, total }: { preview: RiskPreview; total: number }) {
  if (preview.score === null) return <p className="muted">Answer the questions to see the risk level.</p>;
  return (
    <div className="chg-risk-result">
      <div className="row">
        <strong>Risk</strong>
        {preview.level ? <LookupChip list="change_risk" value={preview.level} /> : <span className="muted">{plural(total - preview.answered, 'question')} left to answer</span>}
      </div>
      <ProgressBar
        label="Risk score"
        value={preview.score}
        max={100}
        color={preview.level === 'high' ? 'red' : preview.level === 'medium' ? 'amber' : preview.level === 'low' ? 'green' : 'blue'}
        valueText={`${preview.score} of 100`}
      />
    </div>
  );
}

/** A labeled block of free text that keeps its line breaks. */
export function TextBlock({ label, value, empty = 'Not written yet.' }: { label: string; value: unknown; empty?: string }) {
  const text = String(value ?? '').trim();
  return (
    <section className="chg-text">
      <h3>{label}</h3>
      {text ? <p className="prose">{text}</p> : <p className="muted">{empty}</p>}
    </section>
  );
}
