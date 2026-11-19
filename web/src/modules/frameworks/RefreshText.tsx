// Brings the official NIST CSF 2.0 wording of an installation that loaded it earlier in line
// with the text shipped with the application (E18-03). Shows every difference first; changes
// wording only, never statuses or anything else people recorded.
import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading, api, errorMessage, useToast } from '../../core';

interface TextRefresh {
  outcomes: { code: string; before: string | null; after: string }[];
  structure: { code: string; field: 'name' | 'description'; before: string | null; after: string | null }[];
}

export const SHIPPED_KEY = 'nist-csf-2.0';

export function RefreshTextDialog({ frameworkId, onDone, onCancel }: { frameworkId: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<TextRefresh | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const check = () => {
    setError(null);
    setPreview(null);
    api.post<TextRefresh>(`/api/frameworks/${frameworkId}/refresh-text`, { dryRun: true }).then(setPreview, setError);
  };
  useEffect(check, [frameworkId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    setBusy(true);
    try {
      const done = await api.post<TextRefresh>(`/api/frameworks/${frameworkId}/refresh-text`, {});
      toast.success(`Official wording updated: ${done.outcomes.length} outcome${done.outcomes.length === 1 ? '' : 's'}, ${done.structure.length} name${done.structure.length === 1 ? '' : 's'} or description${done.structure.length === 1 ? '' : 's'}.`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  if (error) return <ErrorState error={error} onRetry={check} />;
  if (!preview) return <Loading lines={4} label="Comparing with the shipped wording" />;
  const count = preview.outcomes.length + preview.structure.length;

  return (
    <div className="form">
      <p className="muted" style={{ margin: 0 }}>
        The wording below differs from the NIST CSF 2.0 text shipped with this version of the application. Updating changes the wording only:
        statuses, owners, targets, evidence, mappings and your own descriptions stay as they are, and outcomes are neither added nor removed.
      </p>
      {count === 0 ? (
        <EmptyState icon="check-circle" title="The wording is up to date" message="Every outcome, function and category already matches the shipped text." />
      ) : (
        <ul className="fw-diff" aria-label="Differences">
          {preview.structure.map((s) => (
            <li key={`${s.code}-${s.field}`}>
              <span className="fw-diff-code">{s.code} · {s.field === 'name' ? 'name' : 'description'}</span>
              {s.before && <span className="fw-diff-old"><span className="sr-only">Now: </span>{s.before}</span>}
              <span><span className="sr-only">Becomes: </span>{s.after}</span>
            </li>
          ))}
          {preview.outcomes.map((o) => (
            <li key={o.code}>
              <span className="fw-diff-code">{o.code}</span>
              {o.before && <span className="fw-diff-old"><span className="sr-only">Now: </span>{o.before}</span>}
              <span><span className="sr-only">Becomes: </span>{o.after}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <Button onClick={onCancel}>{count === 0 ? 'Close' : 'Cancel'}</Button>
        {count > 0 && <Button variant="primary" loading={busy} onClick={apply}>Update {count} item{count === 1 ? '' : 's'}</Button>}
      </div>
    </div>
  );
}
