// Data load mode (E18-70): the switch (a card on Administration > Settings) and the Data loads page,
// which lists what each load created by day and record type and undoes a load. Off by default; on
// for at most 30 days, with a recent password confirmation; undoing asks for the password again.
// A load may name the people it writes for (E18-71); the page lists that work beside the loads.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, Notice, NumberField,
  PageHeader, StatusChip, TableWrap, useAuth, useFetch, useToast,
} from '../../core';
import { confirmIdentity, withReauth } from '../../core/reauth';

interface Load {
  day: string; record_type: string; label: string; route: string | null; records: number; remaining: number;
  first_at: string; last_at: string; people: string | null; tokens: string | null; on_behalf: string | null;
}
/** Work written on behalf of other people (E18-71), from the audit log. */
interface Behalf { day: string; person: string; loaded_by: string; tokens: string | null; events: number }
interface DataLoadView {
  on: boolean; until: string | null; startedAt: string | null; startedByName: string | null;
  maxDays: number; defaultDays: number; mcpWriteEnabled: boolean; loads: Load[]; onBehalf?: Behalf[];
}

const URL = '/api/admin/data-load';

/** The switch, for Administration > Settings. */
export function DataLoadCard() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<DataLoadView>(URL);
  const [days, setDays] = useState<number | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={3} label="Loading data load mode" /></Card>;
  const chosen = days ?? data.defaultDays;

  const change = async (on: boolean) => {
    setBusy(true);
    setFieldError('');
    try {
      const res = await withReauth(() => api.post<DataLoadView>(URL, on ? { on, days: chosen } : { on }));
      toast.success(on ? `Data load mode is on until ${formatDateTime(res.until ?? '')}.` : 'Data load mode is off.');
      reload();
      await auth.refresh();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields?.until) setFieldError(fields.until);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="adm-dataload">
        <p className="adm-dataload-state">
          <StatusChip color={data.on ? 'amber' : 'gray'} label={data.on ? 'On' : 'Off'} />
          {data.on
            ? <span>Until {formatDateTime(data.until!)}{data.startedByName ? `, switched on by ${data.startedByName}` : ''}{data.startedAt ? ` on ${formatDate(data.startedAt)}` : ''}.</span>
            : <span>Records get today&apos;s dates and the usual rules.</span>}
        </p>
        <p className="muted">
          For loading historical records with their original dates, for example when they were opened, resolved and closed.
          While it is on, administrators (and their API and AI assistant tokens) may set every field, read-only ones included, any status,
          the created and updated times and the reference, and name the real person who wrote or did each thing (an account, a roster
          person or just a name); the audit log still records the administrator, adding &ldquo;on behalf of&rdquo; that person.
          Nothing is sent: no notifications, email, webhooks or approvals. Every record
          created is listed under <Link to="/admin/data-loads">Data loads</Link>, where a load can be undone. It switches itself off at the end time.
          {!data.mcpWriteEnabled && ' An AI assistant also needs write access, under AI assistant access.'}
        </p>
        <div className="adm-dataload-controls">
          <NumberField
            label={data.on ? 'Keep it on for (days from now)' : 'Switch on for (days)'} min={1} max={data.maxDays} step={1}
            value={chosen} onChange={(v) => setDays(v ?? null)} error={fieldError}
            hint={`At most ${data.maxDays} days. Switching on asks for your password.`}
          />
          <div className="adm-dataload-buttons">
            <Button variant={data.on ? 'secondary' : 'primary'} loading={busy} onClick={() => void change(true)}>
              {data.on ? 'Change the end' : 'Switch data load mode on'}
            </Button>
            {data.on && <Button variant="danger" loading={busy} onClick={() => void change(false)}>Switch off now</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Administration > Data loads: what each load created, and undoing one. */
export function DataLoadsPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<DataLoadView>(URL);
  const [undo, setUndo] = useState<Load | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      // Undoing a load always asks for the password again, however recently it was given.
      if (!(await confirmIdentity())) { setBusy(false); return; }
      const res = await api.post<{ deleted: number; held: number; missing: number }>(`${URL}/undo`, { type: undo.record_type, day: undo.day });
      toast.success(`${res.deleted} ${undo.label.toLowerCase()} deleted.${res.held ? ` ${res.held} kept: under a legal hold.` : ''}`);
      setUndo(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Data loads" subtitle="Records created in data load mode, by day and record type. A load can be undone here." />
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : !data ? <Card><Loading lines={4} label="Loading data loads" /></Card>
        : (
          <>
            <Notice tone={data.on ? 'warning' : 'info'} title={data.on ? `Data load mode is on until ${formatDateTime(data.until!)}` : 'Data load mode is off'}>
              {data.on
                ? 'Records administrators save now keep the dates and values they are given and send nothing. Switch it off under Settings when the load is done.'
                : <>Switch it on under <Link to="/admin/settings#settings-dataload">Settings</Link> before loading historical records. Loads made earlier can still be undone here.</>}
            </Notice>
            <Card flush title="Loads">
              {data.loads.length === 0
                ? <EmptyState icon="upload" title="Nothing has been loaded" message="Records created in data load mode appear here, grouped by the day they were loaded." />
                : (
                  <TableWrap label="Data loads">
                    <table className="table adm-dataloads">
                      <thead>
                        <tr>
                          <th scope="col">Day</th><th scope="col">Record type</th><th scope="col" className="num">Created</th>
                          <th scope="col" className="num">Still there</th><th scope="col">Loaded by</th><th scope="col"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.loads.map((l) => (
                          <tr key={`${l.day}-${l.record_type}`}>
                            <td>{formatDate(l.day)}</td>
                            <td>{l.route ? <Link to={l.route}>{l.label}</Link> : l.label}</td>
                            <td className="num">{l.records.toLocaleString('en-US')}</td>
                            <td className="num">{l.remaining.toLocaleString('en-US')}</td>
                            <td>
                              {l.people ?? 'System'}{l.tokens ? <span className="muted"> (token {l.tokens})</span> : null}
                              {l.on_behalf ? <span className="muted"> on behalf of {l.on_behalf}</span> : null}
                            </td>
                            <td className="adm-dataloads-action">
                              <Button size="sm" variant="danger" disabled={l.remaining === 0} onClick={() => setUndo(l)}
                                aria-label={`Delete this load: the ${l.remaining} ${l.label.toLowerCase()} loaded on ${formatDate(l.day)}`}>
                                Delete this load
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
            </Card>
            <Card flush title="Written on behalf of others">
              {!data.onBehalf?.length
                ? <EmptyState icon="users" title="Nobody else has been named" message="When a load names the person who wrote or did something, it is listed here by day, with who really loaded it." />
                : (
                  <TableWrap label="Written on behalf of others">
                    <table className="table adm-dataloads">
                      <thead>
                        <tr>
                          <th scope="col">Day</th><th scope="col">On behalf of</th><th scope="col">Loaded by</th>
                          <th scope="col" className="num">Audit log entries</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.onBehalf.map((b) => (
                          <tr key={`${b.day}-${b.person}-${b.loaded_by}`}>
                            <td>{formatDate(b.day)}</td>
                            <td>{b.person}</td>
                            <td>{b.loaded_by}{b.tokens ? <span className="muted"> (token {b.tokens})</span> : null}</td>
                            <td className="num">{b.events.toLocaleString('en-US')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
            </Card>
          </>
        )}
      <ConfirmDialog
        open={undo !== null} danger busy={busy}
        title="Delete everything this load created?"
        message={undo ? `The ${undo.remaining} ${undo.label.toLowerCase()} loaded on ${formatDate(undo.day)} are deleted, as if each were deleted from its page, and the deletion is in the audit log. Records under a legal hold are kept. You will be asked for your password.` : ''}
        confirmLabel="Delete them" onConfirm={() => void run()} onCancel={() => setUndo(null)}
      />
    </>
  );
}
