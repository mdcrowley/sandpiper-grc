// Administration > Confidential safety reports (E41-05): the people named to see who made a safety
// report whose reporter asked to stay confidential. Every look is recorded on the event's history.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  api, Button, Card, ErrorState, errorMessage, Loading, MultiSelect, PageHeader, StatusChip, useFetch, useToast, withReauth,
} from '../../core';

export interface ViewerState {
  viewers: { id: string; label: string; eligible: boolean }[];
  named: boolean;
  eligible?: { id: string; label: string }[];
  can_administer: boolean;
}

export function ConfidentialViewers() {
  const toast = useToast();
  const { data, error, reload } = useFetch<ViewerState>('/api/safety/confidential-viewers');
  const [saved, setSaved] = useState<ViewerState | null>(null);
  const shown = saved ?? data;
  const [people, setPeople] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (shown) setPeople(shown.viewers.map((v) => v.id)); }, [shown]);

  const page = (body: ReactNode) => (
    <div className="stack">
      <PageHeader title="Confidential safety reports" subtitle="Who may see the identity of a reporter who asked to stay confidential." />
      {body}
    </div>
  );
  if (error) return page(<ErrorState title="The named people could not be loaded" error={error} onRetry={reload} />);
  if (!shown) return page(<Loading lines={4} label="Loading the named people" />);
  const admin = shown.can_administer;
  const dirty = people.join() !== shown.viewers.map((v) => v.id).join();
  const options = [
    ...(shown.eligible ?? []).map((p) => ({ value: p.id, label: p.label })),
    ...shown.viewers.filter((v) => !v.eligible).map((v) => ({ value: v.id, label: `${v.label} (cannot see safety events)` })),
  ];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      setSaved(await withReauth(() => api.put<ViewerState>('/api/safety/confidential-viewers', { viewers: people })));
      toast.success('Named people saved.');
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return page(
    <Card title="People who may see a confidential reporter">
      <form className="form" onSubmit={save} noValidate>
        <p className="muted">
          A person reporting a safety concern can ask for their identity to be kept confidential. The event is then saved without their
          name: lists, exports, search, reports, the history and the AI assistant never show it. Only the people named here can see who
          made the report, from the event's page, and each look is recorded on the event's history. Name as few people as you can.
        </p>
        {admin ? (
          <>
            <MultiSelect label="Named people" options={options} value={people} onChange={setPeople} error={errors.viewers} />
            <p className="muted">Active people who can see safety events. Adding someone asks you to confirm your password.</p>
          </>
        ) : shown.viewers.length === 0 && <p>Nobody is named, so nobody can see who made a confidential report.</p>}
        {shown.viewers.length > 0 && (
          <ul className="sf-viewer-list" aria-label="Named people">
            {shown.viewers.map((v) => (
              <li key={v.id}><span>{v.label}</span>{!v.eligible && <StatusChip color="red" label="Cannot see safety events" />}</li>
            ))}
          </ul>
        )}
        {admin && (
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={busy} disabled={!dirty || busy}>Save named people</Button>
          </div>
        )}
      </form>
    </Card>,
  );
}
