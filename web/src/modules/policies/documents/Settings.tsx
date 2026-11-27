// Document settings for document controllers (policies.administer): how numbers are made, the short
// department codes they use, and the acknowledgment reminder interval.
import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, TableWrap, TextField, useFetch, useToast,
} from '../../../core';
import { DocumentsTabs } from './DocumentsTabs';

interface Code { department_id: string; department_name: string; code: string | null }

/** An example of a number made by a pattern, as the server would make it for a procedure of IT. */
export function exampleNumber(pattern: string): string {
  return pattern
    .replace(/\{prefix\}/g, 'SOP')
    .replace(/\{year\}/g, String(new Date().getFullYear()))
    .replace(/\{seq(?::(\d+))?\}/g, (_m, n: string | undefined) => '14'.padStart(Number(n ?? 1), '0'))
    .replace(/\{dept\}/g, 'IT');
}

function Numbering() {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ pattern: string }>('/api/documents/numbering');
  const [pattern, setPattern] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = pattern ?? data?.pattern ?? '';
  const save = async () => {
    setBusy(true);
    setFieldError('');
    try {
      await api.put('/api/documents/numbering', { pattern: value });
      toast.success('Numbering pattern saved. It applies to documents numbered from now on.');
      setPattern(null);
      reload();
    } catch (err) {
      setFieldError(err instanceof ApiError && err.fields?.pattern ? err.fields.pattern : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Document numbers" actions={<Button size="sm" variant="primary" loading={busy} disabled={pattern === null || pattern === data?.pattern} onClick={() => void save()}>Save</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} /> : (
        <div className="stack">
          <TextField
            label="Pattern" value={value} error={fieldError} onChange={setPattern}
            hint="{prefix} is the type's prefix (POL, SOP…), {dept} the owning department's code, {seq} or {seq:3} the next number in that type and department, {year} the year."
          />
          <p className="muted">For example: <strong>{exampleNumber(value) || '—'}</strong>. Numbers already given do not change, and a number is never given twice.</p>
        </div>
      )}
    </Card>
  );
}

function DepartmentCodes() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Code[]>('/api/documents/department-codes');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setCodes(Object.fromEntries(data.map((c) => [c.department_id, c.code ?? '']))); }, [data]);
  const dirty = Boolean(data?.some((c) => (c.code ?? '') !== (codes[c.department_id] ?? '')));
  const save = async () => {
    setBusy(true);
    setErrors({});
    setMessage('');
    try {
      await api.put('/api/documents/department-codes', {
        codes: Object.entries(codes).filter(([, c]) => c.trim()).map(([department_id, code]) => ({ department_id, code: code.trim().toUpperCase() })),
      });
      toast.success('Department codes saved.');
      reload();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) { setErrors(err.fields); setMessage(err.message); } else setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Department codes" flush actions={<Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>Save codes</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={4} /> : (
        <div className="stack">
          <p className="muted doc-pad">The short code of the owning department in document numbers, such as IT or HR: 1 to 10 capital letters or digits, each used once.</p>
          {message && <p className="field-error doc-pad" role="alert">{message}</p>}
          {!data.length ? <p className="muted doc-pad">No departments are set up yet (People &gt; Departments).</p> : (
            <TableWrap label="Department codes">
              <table className="table">
                <caption className="sr-only">Department codes</caption>
                <thead><tr><th scope="col">Department</th><th scope="col">Code</th></tr></thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.department_id}>
                      <td>{c.department_name}</td>
                      <td className="doc-code-cell">
                        <TextField
                          label={`Code of ${c.department_name}`} hideLabel size="xs" value={codes[c.department_id] ?? ''} maxLength={10}
                          error={errors[c.department_id] ?? errors[`codes.${c.department_id}`]}
                          onChange={(v) => setCodes((m) => ({ ...m, [c.department_id]: v.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
      )}
    </Card>
  );
}

function Reminders() {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ reminder_interval_days: number }>('/api/policies/settings');
  const [value, setValue] = useState<number | null>(null);
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const days = value ?? data?.reminder_interval_days ?? null;
  const save = async () => {
    setBusy(true);
    setFieldError('');
    try {
      await api.put('/api/policies/settings', { reminder_interval_days: days });
      toast.success('Reminder interval saved.');
      setValue(null);
      reload();
    } catch (err) {
      setFieldError(err instanceof ApiError && err.fields?.reminder_interval_days ? err.fields.reminder_interval_days : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Acknowledgment reminders" actions={<Button size="sm" variant="primary" loading={busy} disabled={value === null || value === data?.reminder_interval_days} onClick={() => void save()}>Save</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} /> : (
        <div className="stack">
          <p className="muted">
            Once an acknowledgment is past its due date, the person is reminded through their notifications, then again after this many days until they
            acknowledge. A document may set its own interval.
          </p>
          <NumberField label="Days between reminders" value={days} min={1} max={90} step={1} onChange={setValue} error={fieldError} hint="From 1 to 90." />
        </div>
      )}
    </Card>
  );
}

export function DocumentSettings() {
  return (
    <div className="stack">
      <PageHeader title="Document settings" subtitle="Numbering, department codes and acknowledgment reminders. Document types and their review cycles are a list under Administration > Lists." />
      <DocumentsTabs active="settings" />
      <div className="grid-2 doc-settings">
        <div className="stack"><Numbering /><Reminders /></div>
        <DepartmentCodes />
      </div>
    </div>
  );
}
