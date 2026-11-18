import { useEffect, useState, type ReactNode } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, Select, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { DepartmentsCard } from './Departments';
import { adminApi } from './reauth';
import { Switch } from './Switch';

interface Values {
  'app.name': string;
  pilot_mode: boolean;
  features: Record<string, boolean>;
  'auth.password_min_length': number;
  'auth.password_history': number;
  'auth.idle_minutes': number;
  'auth.mfa_required_for_all': boolean;
  'auth.mfa_enforcement': 'off' | 'notice' | 'required';
  'auth.mfa_grace_days': number;
  'auth.reauth_minutes': number;
}
interface SettingsResponse { values: Values; featureKeys: string[] }

const FEATURES: Record<string, { title: string; text: string }> = {
  portal: {
    title: 'Self-service portal',
    text: 'The simpler pages where anyone in the organisation submits and tracks their own requests. Off by default: agents enter tickets on behalf of others. Switch on together with the Requester role when you open the application to everyone.',
  },
};

function Setting({ title, children, text, error }: { title: string; text: ReactNode; children: ReactNode; error?: string }) {
  return (
    <div className="adm-setting">
      <div className="adm-setting-title">{title}</div>
      <div className="muted">{text}</div>
      <div>{children}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<SettingsResponse>('/api/admin/settings');
  const [form, setForm] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(data.values); }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !form) return <Loading lines={10} label="Loading settings" />;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setForm({ ...form, [key]: value });
  const changedKeys = (Object.keys(form) as (keyof Values)[]).filter((k) => JSON.stringify(form[k]) !== JSON.stringify(data.values[k]));

  const save = async () => {
    const found: Record<string, string> = {};
    if (!form['app.name'].trim()) found['app.name'] = 'Enter a name.';
    if (!(form['auth.password_min_length'] >= 12)) found['auth.password_min_length'] = 'The minimum can never be below 12.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await adminApi.patch('/api/admin/settings', Object.fromEntries(changedKeys.map((k) => [k, form[k]])));
      toast.success('Settings saved.');
      reload();
      await auth.refresh();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      toast.error(Object.keys(fields).length ? 'Check the highlighted settings.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Every change here is recorded in the audit log with the old and new value."
        actions={<>
          <Button disabled={changedKeys.length === 0} onClick={() => { setForm(data.values); setErrors({}); }}>Undo changes</Button>
          <Button variant="primary" disabled={changedKeys.length === 0} loading={busy} onClick={() => void save()}>Save settings</Button>
        </>}
      />
      <div className="grid-2">
        <div className="stack">
          <Card title="Application">
            <Setting title="Name" text="Shown on the sign-in page, in the header and as the issuer in authenticator apps." error={undefined}>
              <TextField label="Application name" hideLabel maxLength={60} value={form['app.name']} onChange={(v) => set('app.name', v)} error={errors['app.name']} />
            </Setting>
            <Setting
              title="Pilot mode" error={errors.pilot_mode}
              text="While on, every page carries a banner saying this is a pilot, so nobody mistakes it for the system of record. Switch off only when the application goes into production."
            >
              <Switch label="Pilot mode" checked={form.pilot_mode} onChange={(on) => set('pilot_mode', on)} />
            </Setting>
          </Card>
          <Card title="Feature switches">
            <p className="muted">Parts of the application that are built but stay hidden until you turn them on.</p>
            {data.featureKeys.map((k) => (
              <Setting key={k} title={FEATURES[k]?.title ?? k} text={FEATURES[k]?.text ?? ''} error={errors.features}>
                <Switch
                  label={FEATURES[k]?.title ?? k} checked={Boolean(form.features[k])}
                  onChange={(on) => set('features', { ...form.features, [k]: on })}
                />
              </Setting>
            ))}
            <p className="muted">The audience roles (Requester, Approver, Executive viewer, Auditor) are switched on the Roles page.</p>
          </Card>
        </div>
        <div className="stack">
          <Card title="Sign-in and passwords">
            <Setting title="Minimum password length" text="Default 14. Can never be below 12. There are no composition rules and no forced periodic change; common passwords are always refused.">
              <NumberField label="Minimum password length" hideLabel min={12} max={128} step={1} value={form['auth.password_min_length']}
                onChange={(v) => set('auth.password_min_length', v ?? 0)} error={errors['auth.password_min_length']} />
            </Setting>
            <Setting title="Password history" text="How many of a person's previous passwords may not be reused. Default 5; 0 turns the check off.">
              <NumberField label="Password history" hideLabel min={0} max={24} step={1} value={form['auth.password_history']}
                onChange={(v) => set('auth.password_history', v ?? 0)} error={errors['auth.password_history']} />
            </Setting>
            <Setting title="Idle time-out (minutes)" text="A session ends after this long without activity. Default 30. Every session also ends after 8 hours.">
              <NumberField label="Idle time-out in minutes" hideLabel min={5} max={480} step={1} value={form['auth.idle_minutes']}
                onChange={(v) => set('auth.idle_minutes', v ?? 0)} error={errors['auth.idle_minutes']} />
            </Setting>
            <Setting
              title="Second factor for everyone" error={errors['auth.mfa_required_for_all']}
              text="Roles marked “second factor required” (Administrator and Security lead by default) always expect an authenticator app. Switch this on to expect it of everyone."
            >
              <Switch label="Expect a second factor from every user" checked={form['auth.mfa_required_for_all']} onChange={(on) => set('auth.mfa_required_for_all', on)} />
            </Setting>
            <Setting
              title="When a second factor is expected" error={errors['auth.mfa_enforcement']}
              text="Reminder: people without one see a notice and can carry on (the default). Required: after signing in they can do nothing except set one up. Set up your own second factor before choosing Required."
            >
              <Select
                label="When a second factor is expected" hideLabel value={form['auth.mfa_enforcement']}
                onChange={(v) => set('auth.mfa_enforcement', (v || 'notice') as Values['auth.mfa_enforcement'])}
                options={[{ value: 'off', label: 'Off: no reminder' }, { value: 'notice', label: 'Reminder only' }, { value: 'required', label: 'Required: nothing else works until it is set up' }]}
              />
            </Setting>
            <Setting title="Grace period (days)" text="With Required, how long a person may keep working before the block applies, counted from their first visit. Default 0: no grace period.">
              <NumberField label="Grace period in days" hideLabel min={0} max={30} step={1} value={form['auth.mfa_grace_days']}
                onChange={(v) => set('auth.mfa_grace_days', v ?? 0)} error={errors['auth.mfa_grace_days']} />
            </Setting>
            <Setting title="Password confirmation (minutes)" text="Changing roles, permissions, these sign-in settings, a person's second factor or issuing a one-time link asks for your password again unless you gave it within this many minutes. Default 10.">
              <NumberField label="Password confirmation window in minutes" hideLabel min={1} max={60} step={1} value={form['auth.reauth_minutes']}
                onChange={(v) => set('auth.reauth_minutes', v ?? 10)} error={errors['auth.reauth_minutes']} />
            </Setting>
          </Card>
          <DepartmentsCard />
        </div>
      </div>
    </>
  );
}
