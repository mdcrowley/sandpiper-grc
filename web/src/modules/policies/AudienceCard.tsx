// Who must acknowledge a policy: everyone, or the people in chosen roles and departments.
import { useState } from 'react';
import {
  ApiError, Badge, Button, Card, Checkbox, errorMessage, Modal, MultiSelect, NumberField, useFetch, useToast,
} from '../../core';
import type { RecordContext } from '../../core';

interface Options { roles: { key: string; name: string; enabled: boolean }[]; departments: { id: string; name: string }[] }

export function AudienceCard({ rec }: { rec: RecordContext }) {
  const { row, canEdit } = rec;
  const toast = useToast();
  const { data } = useFetch<Options>('/api/policies/audience-options');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ everyone: false, roles: [] as string[], departments: [] as string[], days: 14 as number | null, remind: null as number | null });

  const roles: string[] = Array.isArray(row.audience_roles) ? row.audience_roles : [];
  const departments: string[] = Array.isArray(row.audience_departments) ? row.audience_departments : [];
  const roleName = (key: string) => data?.roles.find((r) => r.key === key)?.name ?? key;
  const deptName = (id: string) => data?.departments.find((d) => d.id === id)?.name ?? 'Department no longer exists';
  const nobody = !row.audience_everyone && roles.length === 0 && departments.length === 0;

  const edit = () => {
    setForm({ everyone: row.audience_everyone === true, roles, departments, days: Number(row.ack_days) || 14, remind: row.reminder_interval_days == null ? null : Number(row.reminder_interval_days) });
    setMessage('');
    setOpen(true);
  };
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      await rec.save({ audience_everyone: form.everyone, audience_roles: form.roles, audience_departments: form.departments, ack_days: form.days, reminder_interval_days: form.remind });
      toast.success('Audience saved.');
      setOpen(false);
    } catch (err) {
      setMessage(err instanceof ApiError && err.fields ? Object.values(err.fields).join(' ') : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Who must acknowledge" actions={canEdit && row.status !== 'retired' && <Button size="sm" onClick={edit}>Change</Button>}>
      <div className="stack">
        {row.audience_everyone ? (
          <p><Badge color="blue">Everyone</Badge> <span className="muted">Every active user.</span></p>
        ) : nobody ? (
          <p className="muted">Nobody yet. Choose roles or departments, or everyone, before publishing.</p>
        ) : (
          <div className="pol-chips">
            {roles.map((r) => <Badge key={r} color="purple">Role: {roleName(r)}</Badge>)}
            {departments.map((d) => <Badge key={d} color="teal">Department: {deptName(d)}</Badge>)}
          </div>
        )}
        <p className="muted">
          People are asked when a version is published and have {Number(row.ack_days) || 14} days to acknowledge it.
          A change here applies from the next version published.
          {' '}{row.reminder_interval_days ? `Anyone late is reminded every ${row.reminder_interval_days} days.` : 'Anyone late is reminded at the usual interval.'}
        </p>
      </div>

      <Modal
        open={open} title="Who must acknowledge this policy" onClose={() => setOpen(false)} size="sm"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save audience</Button></>}
      >
        <div className="stack">
          {message && <p role="alert" style={{ color: 'var(--danger-text)' }}>{message}</p>}
          <Checkbox label="Everyone" hint="Every active user is asked, whatever their role or department." checked={form.everyone} onChange={(v) => setForm((f) => ({ ...f, everyone: v }))} />
          {!form.everyone && (
            <>
              <MultiSelect label="Roles" value={form.roles} onChange={(v) => setForm((f) => ({ ...f, roles: v }))} options={(data?.roles ?? []).map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))} />
              {data && data.departments.length > 0
                ? <MultiSelect label="Departments" value={form.departments} onChange={(v) => setForm((f) => ({ ...f, departments: v }))} options={data.departments.map((d) => ({ value: d.id, label: d.name }))} />
                : <p className="muted">No departments are set up. An administrator can add them under Administration.</p>}
            </>
          )}
          <NumberField label="Days to acknowledge" min={1} max={365} step={1} value={form.days} onChange={(v) => setForm((f) => ({ ...f, days: v }))} />
          <NumberField
            label="Days between reminders" min={1} max={90} step={1} value={form.remind} onChange={(v) => setForm((f) => ({ ...f, remind: v }))}
            hint="For people who are late. Leave empty for the usual interval set under Policies settings."
          />
        </div>
      </Modal>
    </Card>
  );
}
