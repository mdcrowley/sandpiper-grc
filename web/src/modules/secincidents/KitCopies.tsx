// Stored PDF copies of the offline incident kit (E09-16): whether the latest copy matches the kit,
// the copies to download, making one now, and (for administrators) the schedule and who receives
// each automatic copy by email.
import { useEffect, useState } from 'react';
import { Alert, Group, Stack, Text } from '@mantine/core';
import {
  api, Button, Card, errorMessage, formatDateTime, Icon, MultiSelect, NumberField, useFetch, useToast, withReauth,
} from '../../core';

interface KitCopy {
  id: string; created_at: string; reason: string; reason_label: string; produced_by_name: string | null;
  pages: number; size_bytes: number; delivery: string | null; current: boolean;
}
interface KitCopiesState {
  copies: KitCopy[];
  latest_is_current: boolean;
  current_since: string | null;
  check_minutes: number;
  every_days: number;
  keep: number;
  mail_on: boolean;
  can_export: boolean;
  can_administer: boolean;
  recipients?: { id: string; label: string; eligible: boolean }[];
  eligible?: { id: string; label: string }[];
}

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function Status({ data }: { data: KitCopiesState }) {
  const latest = data.copies[0];
  if (!latest) {
    return (
      <Alert color="blue" variant="light" icon={<Icon name="info" size={18} />} title="No PDF copy yet">
        A first copy is made within {data.check_minutes} minutes{data.can_export ? ', or make one now' : ''}.
      </Alert>
    );
  }
  if (!data.latest_is_current) {
    return (
      <Alert color="amber" variant="light" icon={<Icon name="alert" size={18} />} title="The kit has changed since the last PDF copy" role="status">
        The last copy was made {formatDateTime(latest.created_at)}. A new copy is made within {data.check_minutes} minutes{data.can_export ? ', or make one now' : ''}.
        Reprint the kit and destroy the paper copies printed before the change.
      </Alert>
    );
  }
  return (
    <Alert color="green" variant="light" icon={<Icon name="check-circle" size={18} />} title="The latest PDF copy matches the kit">
      Paper copies printed since {formatDateTime(data.current_since ?? latest.created_at)} are up to date; older ones are not.
    </Alert>
  );
}

function Schedule({ data, onSaved }: { data: KitCopiesState; onSaved: (next: KitCopiesState) => void }) {
  const toast = useToast();
  const [every, setEvery] = useState<number | null>(data.every_days);
  const [keep, setKeep] = useState<number | null>(data.keep);
  const [people, setPeople] = useState<string[]>((data.recipients ?? []).map((r) => r.id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEvery(data.every_days); setKeep(data.keep); setPeople((data.recipients ?? []).map((r) => r.id));
  }, [data]);
  // Named people who can no longer receive the kit are listed too, so they can be taken off.
  const options = [
    ...(data.eligible ?? []).map((p) => ({ value: p.id, label: p.label })),
    ...(data.recipients ?? []).filter((r) => !r.eligible).map((r) => ({ value: r.id, label: `${r.label} (cannot receive it)` })),
  ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const next = await withReauth(() => api.patch<KitCopiesState>('/api/security-incidents/kit/settings', { every_days: every, keep, recipients: people }));
      onSaved(next);
      toast.success('Kit schedule saved.');
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="si-kit-schedule">
      <Text fw={650} size="sm">Schedule</Text>
      <div className="si-kit-schedule-grid">
        <NumberField label="Fresh copy every (days)" value={every} onChange={setEvery} min={0} max={90} step={1} error={errors.every_days}
          hint="0: only after a change. A change is picked up within the check interval whatever this says." />
        <NumberField label="Copies kept" value={keep} onChange={setKeep} min={1} max={100} step={1} error={errors.keep} />
      </div>
      <MultiSelect label="Email each automatic copy to" options={options} value={people} onChange={setPeople} error={errors.recipients} />
      <Text size="xs" c="dimmed">
        Only active people with security.view and security.export can be chosen; anyone who loses them is skipped when the email is sent.
        The PDF is attached, so the kit can be reached when this application cannot. Changing who receives it asks you to confirm your identity.
        {!data.mail_on && ' Email is switched off: nothing is sent until an administrator sets it up.'}
      </Text>
      <Group justify="flex-end">
        <Button type="submit" variant="secondary" loading={busy}>Save schedule</Button>
      </Group>
    </form>
  );
}

/** The panel above the printable kit. Hidden when printing. */
export function KitCopies() {
  const toast = useToast();
  const { data, error, reload } = useFetch<KitCopiesState>('/api/security-incidents/kit/copies');
  const [state, setState] = useState<KitCopiesState | undefined>(undefined);
  const [making, setMaking] = useState(false);
  useEffect(() => { if (data) setState(data); }, [data]);
  const shown = state ?? data;

  async function makeNow() {
    setMaking(true);
    try {
      await api.post('/api/security-incidents/kit/copies');
      toast.success('A new PDF copy of the kit was made.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMaking(false);
    }
  }

  if (error) return <Card title="PDF copies" className="si-no-print"><Text size="sm" c="red">The stored copies could not be loaded: {errorMessage(error)}</Text></Card>;
  if (!shown) return null;
  return (
    <Card
      title="PDF copies" className="si-no-print si-kit-copies"
      actions={shown.can_export && <Button variant="secondary" icon="plus" loading={making} onClick={makeNow}>Make a PDF copy now</Button>}
    >
      <Stack gap="md">
        <Status data={shown} />
        <Text size="sm" c="dimmed">
          The server makes a PDF of the kit after any change to the rules, contacts or checklists (checked every {shown.check_minutes} minutes)
          {shown.every_days > 0 ? ` and at least every ${shown.every_days} days` : ''}, with the time it was made on every page.
          {!shown.can_export && ' Downloading a copy needs export permission for security incidents.'}
        </Text>
        {shown.copies.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Stored PDF copies of the kit, newest first</caption>
              <thead>
                <tr><th scope="col">Made</th><th scope="col">Why</th><th scope="col">Pages</th><th scope="col">Email</th><th scope="col"><span className="sr-only">Download</span></th></tr>
              </thead>
              <tbody>
                {shown.copies.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      {formatDateTime(c.created_at)}
                      {i === 0 && c.current && <span className="chip chip-green si-kit-chip">Current</span>}
                      {!c.current && <span className="chip chip-gray si-kit-chip">Out of date</span>}
                    </td>
                    <td>{c.reason_label}{c.produced_by_name ? `, by ${c.produced_by_name}` : ''}</td>
                    <td className="si-kit-nowrap">{c.pages} · {size(c.size_bytes)}</td>
                    <td className="si-kit-delivery">{c.delivery ?? '—'}</td>
                    <td>
                      {shown.can_export && (
                        <a className="btn btn-ghost btn-sm" href={`/api/security-incidents/kit/copies/${c.id}/pdf`} download
                          aria-label={`Download the copy made ${formatDateTime(c.created_at)}`}>
                          <Icon name="download" size={16} /> PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.can_administer && <Schedule data={shown} onSaved={setState} />}
      </Stack>
    </Card>
  );
}
