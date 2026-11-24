import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, DateField, ErrorState, errorMessage, formatDate, Loading, Modal, TextArea, todayInZone, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { daysUntil, DueChip, RatedChip } from './scales';
import { addDays } from '../../../../shared/dates.ts';

interface Review {
  id: string;
  reviewed_on: string;
  note: string | null;
  next_review_on: string | null;
  residual_label: string | null;
  residual_color: string;
  inherent_label: string | null;
  inherent_color: string;
  reviewed_by: string | null;
}

/** The dialog that completes a review: a note and the date of the next one. */
export function ReviewDialog({ risk, onClose, onDone }: {
  risk: { id: string; ref?: string; title?: string; review_on?: string | null; last_reviewed_on?: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [suggested, setSuggested] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!risk) return;
    // Suggest the same gap as last time (between the last review and the date it set), else 90 days.
    const gap = risk.last_reviewed_on && risk.review_on ? (daysUntil(risk.review_on) ?? 0) - (daysUntil(risk.last_reviewed_on) ?? 0) : 90;
    setNote('');
    const first = addDays(todayInZone(), gap >= 7 && gap <= 1100 ? gap : 90);
    setNext(first);
    setSuggested(first);
    setErrors({});
    setMessage('');
  }, [risk]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!risk) return;
    if (!next) { setErrors({ next_review_on: 'Give the date of the next review.' }); return; }
    setSaving(true);
    setMessage('');
    try {
      await api.post(`/api/risks/${risk.id}/reviews`, { note, next_review_on: next });
      toast.success(`Review recorded. Next review ${formatDate(next)}.`);
      onDone();
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : {});
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={risk !== null} title="Complete review" size="sm" onClose={onClose} dirty={risk !== null && (Boolean(note.trim()) || next !== suggested)}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted" style={{ margin: 0 }}>
          {risk?.ref ? <><span className="ref">{risk.ref}</span> {risk.title}. </> : null}
          Check the scores, controls and treatment first. Completing the review records today as the review date, keeps the ratings as they
          stand now, and sets the next review.
        </p>
        {message && <p role="alert" className="form-error">{message}</p>}
        <TextArea label="What the review found" rows={3} value={note} onChange={setNote} hint="Optional. For example: controls still working, no change." />
        <DateField label="Next review" required value={next} error={errors.next_review_on} onChange={setNext} />
        <div className="form-actions">
          <Button variant="primary" type="submit" loading={saving}>Complete review</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

/** When the risk is next reviewed, when it last was, and the reviews so far. */
export function ReviewPanel({ rec }: { rec: RecordContext }) {
  const { row } = rec;
  const { data, error, reload } = useFetch<Review[]>(`/api/risks/${row.id}/reviews`);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const left = daysUntil(row.review_on);

  return (
    <Card title="Review" actions={rec.canEdit && <Button size="sm" icon="check" onClick={() => setOpen(true)}>Complete review</Button>}>
      <div className="rk-review">
        <div className="rk-review-next">
          <span className="rk-step-label">Next review</span>
          <span className="rk-review-date">{row.review_on ? formatDate(row.review_on) : 'Not set'}</span>
          {row.review_on && <DueChip date={row.review_on} warnDays={30} overdueWord="Overdue by" />}
          {left === null && <span className="muted">Set a date with “Edit details”, or complete a review.</span>}
        </div>
        <div className="rk-review-last">
          <span className="rk-step-label">Last reviewed</span>
          <span>{row.last_reviewed_on ? formatDate(row.last_reviewed_on) : 'Never'}</span>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={2} label="Loading reviews" />
        : data.length > 0 && (
          <ol className="rk-review-list" aria-label="Reviews so far">
            {(showAll ? data : data.slice(0, 2)).map((v) => (
              <li key={v.id}>
                <span className="rk-review-when">{formatDate(v.reviewed_on)}</span>
                <span className="rk-review-what">
                  <RatedChip label={v.residual_label ?? v.inherent_label} color={v.residual_label ? v.residual_color : v.inherent_color} />
                  <span>{v.note || <span className="muted">No note</span>}</span>
                </span>
                <span className="muted">{v.reviewed_by ?? 'System'}</span>
              </li>
            ))}
          </ol>
        )}
      {data && data.length > 2 && (
        <div><Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${data.length} reviews`}</Button></div>
      )}
      <ReviewDialog risk={open ? row : null} onClose={() => setOpen(false)} onDone={() => { reload(); rec.reload(); }} />
    </Card>
  );
}
