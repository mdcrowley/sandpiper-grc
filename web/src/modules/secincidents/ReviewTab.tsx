import { useState } from 'react';
import {
  ApiError, Button, Card, DefinitionList, EditableSummary, errorMessage, formatDate, formatDateTime, Icon, LookupChip, Modal, ResourceForm,
  Stepper, TextArea, todayInZone, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { ActionsPanel } from '../risks/ActionsPanel';
import type { Lifecycle } from './types';

const NEEDED: [string, string][] = [['what_happened', 'What happened'], ['root_cause', 'Root cause'], ['to_improve', 'What to improve']];

/**
 * Lessons learned: the post-incident review workflow (schedule, draft, complete), the findings
 * and the follow-up actions. A completed review is frozen until it is reopened.
 */
export function ReviewTab({ rec, lifecycle, onSaved }: { rec: RecordContext; lifecycle: Lifecycle | undefined; onSaved: () => void }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const hasActions = !!useResource('action');
  const [arranging, setArranging] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState('');

  const statuses = lifecycle?.review_statuses ?? [];
  const stage = statuses.find((s) => s.value === row.review_status)?.stage ?? 'open';
  const first = (wanted: string) => statuses.find((s) => s.stage === wanted)?.value;
  const missing = NEEDED.filter(([f]) => !String(row[f] ?? '').trim()).map(([, label]) => label);
  const overdue = stage === 'open' && row.review_due_on && String(row.review_due_on).slice(0, 10) < todayInZone();

  async function move(status: string | undefined, done: string) {
    if (!status || status === row.review_status) return;
    setBusy(status);
    try {
      await save({ review_status: status });
      toast.success(done);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError && err.fields ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function skip(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setReasonError('Say why no review is needed; the reason is added to the incident log.'); return; }
    setBusy('skip');
    try {
      await save({ review_status: first('not_required'), review_skip_reason: reason.trim() });
      toast.success('Review marked not required.');
      setSkipping(false);
      onSaved();
    } catch (err) {
      setReasonError(errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const steps = statuses.filter((s) => s.stage !== 'not_required').map((s) => ({ key: s.value, label: s.label }));
  const open = statuses.filter((s) => s.stage === 'open');

  return (
    <div className="stack">
      <Card title="Post-incident review" actions={<LookupChip list="incident_review_status" value={row.review_status} />}>
        <div className="stack">
          {stage === 'not_required' ? (
            <div className="notice" role="note">
              <Icon name="info" size={16} />
              <span>No review is needed for this incident. Reason: {row.review_skip_reason || 'not given'}</span>
            </div>
          ) : (
            <Stepper label="Review progress" current={row.review_status} steps={steps}
              onStepClick={canEdit && stage === 'open' ? (key) => {
                if (open.some((s) => s.value === key)) void move(key, 'Review status changed.');
              } : undefined} />
          )}
          {stage === 'open' && !row.closed_at && (
            <p className="muted">The review usually follows closure. Closing the incident sets the date the review is due.</p>
          )}
          <DefinitionList items={[
            { label: 'Due', value: row.review_due_on ? <span className={overdue ? 'si-overdue' : undefined}>{formatDate(row.review_due_on)}{overdue ? ' (overdue)' : ''}</span> : null },
            { label: 'Review lead', value: row._display?.review_lead_id },
            { label: 'Review meeting', value: row.review_held_at ? formatDateTime(row.review_held_at) : null },
            { label: 'Who took part', value: row.review_attendees, wide: String(row.review_attendees ?? '').length > 60 },
            ...(stage === 'completed' ? [{ label: 'Completed', value: `${formatDateTime(row.review_completed_at)}${row._display?.review_completed_by ? ` by ${row._display.review_completed_by}` : ''}` }] : []),
          ]} />
          {canEdit && (
            <div className="si-review-actions">
              {stage === 'open' && (
                <>
                  <Button icon="calendar" onClick={() => setArranging(true)}>Plan the review</Button>
                  <Button variant="primary" icon="check" loading={busy === first('completed')} disabled={missing.length > 0}
                    onClick={() => move(first('completed'), 'Review completed and added to the log.')}>Complete review</Button>
                  <Button variant="ghost" onClick={() => { setReason(''); setReasonError(''); setSkipping(true); }}>No review needed</Button>
                </>
              )}
              {stage !== 'open' && (
                <Button icon="refresh" loading={busy === first('open')} onClick={() => move(open[open.length - 1]?.value ?? first('open'), 'Review reopened.')}>Reopen review</Button>
              )}
              {stage === 'open' && missing.length > 0 && (
                <span className="si-review-missing">To complete the review, fill in: {missing.join(', ')}.</span>
              )}
              {stage === 'completed' && <span className="si-review-missing">The findings are frozen. Reopen the review to change them.</span>}
            </div>
          )}
        </div>
      </Card>

      <EditableSummary type="security_incident" row={row} onSaved={onSaved} title="Findings" editable={canEdit && stage !== 'completed'}
        fields={['what_happened', 'root_cause', 'went_well', 'to_improve']} />

      {hasActions && (
        <section className="stack" aria-label="Follow-up actions">
          <p className="muted">Turn each improvement into a follow-up action with an owner and a due date. They also appear in the action tracker.</p>
          <ActionsPanel sourceType="security_incident" sourceId={row.id} source="incident" />
        </section>
      )}

      <Modal open={arranging} title="Plan the review" onClose={() => setArranging(false)}>
        <ResourceForm type="security_incident" id={row.id} initial={row}
          fields={['review_due_on', 'review_lead_id', 'review_held_at', 'review_attendees']}
          hints={{ review_attendees: 'Names or roles of the people at the review', review_held_at: 'When the review meeting is, or was, held' }}
          onCancel={() => setArranging(false)}
          onSaved={() => { setArranging(false); toast.success('Review plan saved.'); rec.reload(); onSaved(); }} />
      </Modal>

      <Modal open={skipping} title="No review needed" onClose={() => setSkipping(false)} size="sm">
        <form className="form" onSubmit={skip} noValidate>
          <TextArea label="Why no review is needed" required value={reason} onChange={setReason} error={reasonError} rows={3}
            hint="For example: a false alarm with no impact. The reason is written to the incident log as a decision" />
          <div className="form-actions">
            <Button onClick={() => setSkipping(false)}>Cancel</Button>
            <Button variant="primary" type="submit" loading={busy === 'skip'}>Mark not required</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
