import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { Notice } from './common';
import { DepartmentsCard } from './Departments';
import { adminApi } from './reauth';
import { Switch } from './Switch';

type Enforcement = 'off' | 'notice' | 'required';

interface Values {
  'app.name': string;
  pilot_mode: boolean;
  features: Record<string, boolean>;
  'auth.password_min_length': number | null;
  'auth.password_history': number | null;
  'auth.idle_minutes': number | null;
  'auth.mfa_required_for_all': boolean;
  'auth.mfa_enforcement': Enforcement;
  'auth.mfa_grace_days': number | null;
  'auth.reauth_minutes': number | null;
  'tokens.max_days': number | null;
  'tokens.rate_per_minute': number | null;
  'integrations.outbound_enabled': boolean;
  'integrations.allowed_hosts': string[];
  'retention.audit_months': number | null;
}
interface SettingsResponse { values: Values; featureKeys: string[] }

/** The whole-number settings and the range the server accepts for each. */
const RANGES: Partial<Record<keyof Values, { min: number; max: number; what: string }>> = {
  'auth.password_min_length': { min: 12, max: 128, what: 'Minimum password length' },
  'auth.password_history': { min: 0, max: 24, what: 'Password history' },
  'auth.idle_minutes': { min: 5, max: 480, what: 'Idle time-out' },
  'auth.mfa_grace_days': { min: 0, max: 30, what: 'Grace period' },
  'auth.reauth_minutes': { min: 1, max: 60, what: 'Password confirmation window' },
  'tokens.max_days': { min: 1, max: 3650, what: 'Longest token life' },
  'tokens.rate_per_minute': { min: 10, max: 6000, what: 'Requests a minute' },
  'retention.audit_months': { min: 12, max: 1200, what: 'Audit log retention' },
};

/** The allowed hosts as typed (one to a line), cleaned the way the server stores them. */
const cleanHosts = (lines: unknown) => [...new Set((Array.isArray(lines) ? lines : []).map((h) => h.trim().toLowerCase()).filter(Boolean))];
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/;

const FEATURES: Record<string, { title: string; text: string }> = {
  portal: {
    title: 'Self-service portal',
    text: 'The simpler pages where anyone in the organization submits and tracks their own requests. Off by default: agents enter tickets on behalf of others. Switch on together with the Requester role when you open the application to everyone.',
  },
};

const ENFORCEMENT: { value: Enforcement; label: string; text: string }[] = [
  { value: 'off', label: 'Off', text: 'Nobody is reminded or blocked.' },
  { value: 'notice', label: 'Reminder', text: 'People without one see a reminder on every page and can carry on working.' },
  { value: 'required', label: 'Required', text: 'After signing in, people without one can do nothing except set one up, change their password or sign out.' },
];

const GROUPS: { id: string; title: string; needs?: keyof Values }[] = [
  { id: 'identity', title: 'Identity' },
  { id: 'security', title: 'Security' },
  { id: 'sessions', title: 'Sessions' },
  { id: 'tokens', title: 'API tokens', needs: 'tokens.max_days' },
  { id: 'integrations', title: 'Outbound connections', needs: 'integrations.outbound_enabled' },
  { id: 'retention', title: 'Retention', needs: 'retention.audit_months' },
  { id: 'features', title: 'Features' },
  { id: 'files', title: 'Files' },
  { id: 'departments', title: 'Departments' },
];

/** One setting: what it is on the left, its control on the right, a server or validation message underneath. */
function Setting({ title, text, children, error, changed }: { title: string; text: ReactNode; children: ReactNode; error?: string; changed?: boolean }) {
  return (
    <div className={`adm-setting${error ? ' adm-setting-invalid' : ''}`}>
      <div className="adm-setting-about">
        <div className="adm-setting-title">{title}{changed && <span className="adm-setting-changed">Changed</span>}</div>
        <div className="adm-setting-text">{text}</div>
      </div>
      <div className="adm-setting-control">
        {children}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function Group({ id, title, text, children }: { id: string; title: string; text: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="adm-group" tabIndex={-1} aria-labelledby={`settings-${id}-title`}>
      <header className="adm-group-head">
        <h2 id={`settings-${id}-title`}>{title}</h2>
        <p className="muted">{text}</p>
      </header>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<SettingsResponse>('/api/admin/settings');
  // Whether this administrator has a second factor: the server refuses "Required" without one.
  const mine = useFetch<{ totpEnabled: boolean }>('/api/auth/security');
  const [form, setForm] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(data.values); }, [data]);
  // Other pages link to a group (/admin/settings#settings-integrations): go there once the page is drawn.
  const ready = Boolean(data && form);
  useEffect(() => {
    if (!ready || !window.location.hash.startsWith('#settings-')) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [ready]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !form) return <Loading lines={10} label="Loading settings" />;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setForm({ ...form, [key]: value });
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };
  const has = (k: keyof Values) => k in data.values;
  // Allowed hosts are typed one to a line: blank lines and spacing are not changes.
  const comparable = (k: keyof Values, v: unknown) => (k === 'integrations.allowed_hosts' ? cleanHosts(v) : v);
  const isChanged = (k: keyof Values) => JSON.stringify(comparable(k, form[k])) !== JSON.stringify(comparable(k, data.values[k]));
  const changedKeys = (Object.keys(form) as (keyof Values)[]).filter(isChanged);
  const number = (key: keyof Values, label: string, hint?: string) => (
    <NumberField
      label={label} hideLabel min={RANGES[key]!.min} max={RANGES[key]!.max} step={1} value={form[key] as number | null}
      onChange={(v) => set(key, v as never)} error={errors[key]} hint={hint ?? `From ${RANGES[key]!.min} to ${RANGES[key]!.max}.`}
    />
  );
  const wantsRequired = form['auth.mfa_enforcement'] === 'required' && data.values['auth.mfa_enforcement'] !== 'required';
  const noOwnFactor = wantsRequired && mine.data?.totpEnabled === false;

  const save = async () => {
    const found: Record<string, string> = {};
    const name = form['app.name'].trim();
    if (name.length < 1 || name.length > 60) found['app.name'] = 'Enter a name of 1 to 60 characters.';
    for (const [key, range] of Object.entries(RANGES) as [keyof Values, { min: number; max: number; what: string }][]) {
      if (!(key in data.values)) continue; // a setting this server does not offer
      const v = form[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < range.min || v > range.max) found[key] = `${range.what} must be a whole number from ${range.min} to ${range.max}.`;
    }
    if (noOwnFactor) found['auth.mfa_enforcement'] = 'Set up your own second factor first (Account security), then require it.';
    if (has('integrations.allowed_hosts')) {
      const hosts = cleanHosts(form['integrations.allowed_hosts']);
      const bad = hosts.find((h) => !HOST_RE.test(h));
      if (bad) found['integrations.allowed_hosts'] = `"${bad}" is not a host name. Use "host", "host:port" or "*.domain".`;
      else if (hosts.length > 50) found['integrations.allowed_hosts'] = 'List up to 50 host names.';
    }
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) { toast.error('Check the highlighted settings.'); return; }
    setBusy(true);
    try {
      await adminApi.patch('/api/admin/settings', Object.fromEntries(changedKeys.map((k) => [
        k, k === 'integrations.allowed_hosts' ? cleanHosts(form[k]) : form[k],
      ])));
      toast.success('Settings saved.');
      reload();
      await auth.refresh();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      // A message for a setting that has no place on this page still has to be seen.
      const unplaced = Object.entries(fields).filter(([k]) => !(k in form)).map(([k, m]) => `${k}: ${m}`);
      setFormError(Object.keys(fields).length === 0 ? errorMessage(err) : unplaced.join(' '));
      toast.error(Object.keys(fields).length ? 'Nothing was saved. Check the highlighted settings.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const problems = Object.keys(errors).filter((k) => k in form).length;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Every change here is recorded in the audit log with the old and new value."
        actions={<>
          {changedKeys.length > 0 && <span className="adm-unsaved" role="status">{changedKeys.length} unsaved {changedKeys.length === 1 ? 'change' : 'changes'}</span>}
          <Button disabled={changedKeys.length === 0} onClick={() => { setForm(data.values); setErrors({}); setFormError(''); }}>Undo changes</Button>
          <Button variant="primary" disabled={changedKeys.length === 0} loading={busy} onClick={() => void save()}>Save settings</Button>
        </>}
      />
      <div className="adm-settings">
        <nav className="adm-settings-nav" aria-label="Settings groups">
          {GROUPS.filter((g) => !g.needs || has(g.needs)).map((g) => <a key={g.id} href={`#settings-${g.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`settings-${g.id}`)?.scrollIntoView({ block: 'start' }); document.getElementById(`settings-${g.id}`)?.focus(); }}>{g.title}</a>)}
        </nav>
        <div className="adm-settings-body">
          {(formError || problems > 0) && (
            <p className="form-error" role="alert">
              {formError || `${problems} ${problems === 1 ? 'setting needs' : 'settings need'} attention. Nothing has been saved.`}
            </p>
          )}

          <Group id="identity" title="Identity" text="What the application calls itself.">
            <Card>
              <Setting title="Application name" changed={isChanged('app.name')} text="Shown on the sign-in page, in the header and as the account name in authenticator apps. Up to 60 characters.">
                <TextField label="Application name" hideLabel maxLength={60} value={form['app.name']} onChange={(v) => set('app.name', v)} error={errors['app.name']} />
              </Setting>
              <Setting
                title="Pilot mode" error={errors.pilot_mode} changed={isChanged('pilot_mode')}
                text="While on, every page carries a label saying this is a pilot, so nobody mistakes it for the system of record. Switch off only when the application goes into real use."
              >
                <Switch label="Pilot mode" checked={form.pilot_mode} onChange={(on) => set('pilot_mode', on)} />
              </Setting>
            </Card>
          </Group>

          <Group id="security" title="Security" text="Passwords, the second sign-in factor and password confirmation. Changing any of these asks for your password.">
            <Card title="Passwords">
              <Setting title="Minimum password length" changed={isChanged('auth.password_min_length')} text="Default 14. Never below 12. There are no rules about capitals, numbers or symbols and no forced periodic change; commonly used passwords are always refused.">
                {number('auth.password_min_length', 'Minimum password length', 'Characters, from 12 to 128.')}
              </Setting>
              <Setting title="Password history" changed={isChanged('auth.password_history')} text="How many of a person's previous passwords may not be reused. Default 5; 0 turns the check off.">
                {number('auth.password_history', 'Password history', 'Passwords, from 0 to 24.')}
              </Setting>
            </Card>
            <Card title="Second factor">
              <Setting
                title="Who is expected to have one" error={errors['auth.mfa_required_for_all']} changed={isChanged('auth.mfa_required_for_all')}
                text={<>Members of roles marked “Members must use a second factor” are always expected to. Switch this on to expect it of everyone. Roles are marked on the <Link to="/admin/roles">Roles</Link> page.</>}
              >
                <Switch label="Expect a second factor from every user" checked={form['auth.mfa_required_for_all']} onChange={(on) => set('auth.mfa_required_for_all', on)} />
              </Setting>
              <Setting
                title="Enforcement" error={errors['auth.mfa_enforcement']} changed={isChanged('auth.mfa_enforcement')}
                text="What happens to a person who is expected to have a second factor and has not set one up. The starting value is Reminder, so nobody is locked out by surprise; choose Required before real records are entered."
              >
                <SegmentedControl
                  aria-label="Second factor enforcement" fullWidth value={form['auth.mfa_enforcement']}
                  onChange={(v) => set('auth.mfa_enforcement', v as Enforcement)}
                  data={ENFORCEMENT.map((o) => ({ value: o.value, label: o.label }))}
                />
                <p className="field-hint" role="status">{ENFORCEMENT.find((o) => o.value === form['auth.mfa_enforcement'])?.text}</p>
                {noOwnFactor && !errors['auth.mfa_enforcement'] && (
                  <Notice tone="caution">
                    You have no second factor yourself, so this change will be refused. <Link to="/account/security">Set up your own second factor</Link> first.
                  </Notice>
                )}
              </Setting>
              <Setting title="Grace period" changed={isChanged('auth.mfa_grace_days')} text="With Required, how many days a person may keep working before the block applies, counted from their first visit. Default 0: no grace period.">
                {number('auth.mfa_grace_days', 'Grace period in days', form['auth.mfa_enforcement'] === 'required' ? 'Days, from 0 to 30.' : 'Days, from 0 to 30. Only used when enforcement is Required.')}
              </Setting>
            </Card>
            <Card title="Password confirmation">
              <Setting title="Ask again after" changed={isChanged('auth.reauth_minutes')} text="Changing roles, permissions, these security settings, a person's second factor, or issuing a one-time link asks for your password again unless you gave it within this many minutes. Default 10.">
                {number('auth.reauth_minutes', 'Password confirmation window in minutes', 'Minutes, from 1 to 60.')}
              </Setting>
            </Card>
          </Group>

          <Group id="sessions" title="Sessions" text="How long a signed-in browser stays signed in.">
            <Card>
              <Setting title="Idle time-out" changed={isChanged('auth.idle_minutes')} text="A session ends after this long without activity. Default 30. Changing it asks for your password.">
                {number('auth.idle_minutes', 'Idle time-out in minutes', 'Minutes, from 5 to 480.')}
              </Setting>
              <Setting title="Longest session" text="Every session ends 8 hours after sign-in, whatever the idle time-out. This is fixed.">
                <span className="adm-fixed">8 hours</span>
              </Setting>
            </Card>
          </Group>

          {has('tokens.max_days') && (
            <Group id="tokens" title="API tokens" text="Personal tokens that let scripts and other systems use the API as the person who made them. Changing these asks for your password.">
              <Card>
                <Setting title="Longest token life" changed={isChanged('tokens.max_days')} text={<>A new token must expire within this many days. Tokens already made keep their expiry. Default 365. Everyone's tokens are listed under <Link to="/admin/tokens">API tokens</Link>.</>}>
                  {number('tokens.max_days', 'Longest token life in days', 'Days, from 1 to 3650.')}
                </Setting>
                {has('tokens.rate_per_minute') && (
                  <Setting title="Requests a minute" changed={isChanged('tokens.rate_per_minute')} text="How many requests one token may make in a minute; more are refused until the next minute. Default 600.">
                    {number('tokens.rate_per_minute', 'Requests a minute for each token', 'Requests, from 10 to 6000.')}
                  </Setting>
                )}
              </Card>
            </Group>
          )}

          {has('integrations.outbound_enabled') && (
            <Group id="integrations" title="Outbound connections" text="Whether the application may connect to other systems, for webhooks. Changing these asks for your password.">
              <Card>
                <Setting
                  title="Outbound connections" error={errors['integrations.outbound_enabled']} changed={isChanged('integrations.outbound_enabled')}
                  text={<>Off by default: nothing leaves the application. While off, webhook deliveries are recorded as blocked and never sent. Webhooks are set up under <Link to="/admin/webhooks">Webhooks</Link>.</>}
                >
                  <Switch label="Allow outbound connections" checked={form['integrations.outbound_enabled']} onChange={(on) => set('integrations.outbound_enabled', on)} />
                </Setting>
                {has('integrations.allowed_hosts') && (
                  <Setting
                    title="Allowed hosts" changed={isChanged('integrations.allowed_hosts')}
                    text="The only hosts a delivery may go to, one to a line: a host name (receiver.example.org), a host and port (receiver.example.org:8443) or every host under a domain (*.example.org). Anything else is blocked. Up to 50."
                  >
                    <TextArea
                      label="Allowed hosts" hideLabel rows={4} placeholder="No hosts allowed. For example: receiver.example.org"
                      value={(Array.isArray(form['integrations.allowed_hosts']) ? form['integrations.allowed_hosts'] : []).join('\n')} onChange={(v) => set('integrations.allowed_hosts', v.split('\n'))}
                      error={errors['integrations.allowed_hosts']}
                    />
                  </Setting>
                )}
              </Card>
            </Group>
          )}

          {has('retention.audit_months') && (
            <Group id="retention" title="Retention" text="How long records are kept. The periods for each kind of record are on the Retention page.">
              <Card>
                <Setting title="Audit log" changed={isChanged('retention.audit_months')} text={<>How long the audit log is to be kept, for your records schedule. It is recorded only: audit events are never deleted. Default 84 months (7 years). Periods for records are set under <Link to="/admin/retention">Retention</Link>.</>}>
                  {number('retention.audit_months', 'Audit log retention in months', 'Months, from 12 to 1200.')}
                </Setting>
              </Card>
            </Group>
          )}

          <Group id="features" title="Features" text="Parts of the application that stay hidden until you switch them on.">
            <Card>
              {data.featureKeys.length === 0 && <p className="muted">This version has no feature switches.</p>}
              {data.featureKeys.map((k) => (
                <Setting key={k} title={FEATURES[k]?.title ?? k} text={FEATURES[k]?.text ?? 'No description is available for this switch.'} error={errors.features} changed={form.features[k] !== data.values.features[k]}>
                  <Switch
                    label={FEATURES[k]?.title ?? k} checked={Boolean(form.features[k])}
                    onChange={(on) => set('features', { ...form.features, [k]: on })}
                  />
                </Setting>
              ))}
              <p className="muted adm-setting-note">The audience roles (Requester, Approver, Executive viewer, Auditor) are switched on the <Link to="/admin/roles">Roles</Link> page.</p>
            </Card>
          </Group>

          <Group id="files" title="Files" text="Limits for files attached to records. They apply to new uploads and are saved with their own button.">
            <FilesCard />
          </Group>

          <Group id="departments" title="Departments" text="The list used to group people. Changes here save at once.">
            <DepartmentsCard />
          </Group>
        </div>
      </div>
    </>
  );
}

interface FileConfig { maxBytes: number; allowedExtensions: string[]; scanner?: string }

/** The attachment limits, which belong to the attachments part of the server and save on their own. */
function FilesCard() {
  const toast = useToast();
  const { data, error, reload } = useFetch<FileConfig>('/api/attachments/config');
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const [types, setTypes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const start = data ? { maxMb: Math.round(data.maxBytes / (1024 * 1024)), types: data.allowedExtensions.join(', ') } : null;
  useEffect(() => {
    if (!start) return;
    setMaxMb(start.maxMb);
    setTypes(start.types);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <Card><p className="muted">File attachments are not part of this installation, so there is nothing to set.</p></Card>
      : <Card><ErrorState error={error} onRetry={reload} /></Card>;
  }
  if (!data || !start) return <Card><Loading lines={3} label="Loading file settings" /></Card>;
  const dirty = maxMb !== start.maxMb || types !== start.types;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      await api.patch('/api/attachments/settings', { maxMb, allowedExtensions: types });
      toast.success('File settings saved.');
      reload();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <Setting title="Largest file" changed={maxMb !== start.maxMb} text="Each attached file may be up to this size.">
          <NumberField label="Largest file in megabytes" hideLabel min={1} max={2048} step={1} value={maxMb} onChange={setMaxMb} error={errors.maxMb} hint="Megabytes, from 1 to 2048." />
        </Setting>
        <Setting title="Allowed file types" changed={types !== start.types} text="Extensions separated by commas. A file is refused when its content does not match its extension. Programs and scripts can never be allowed.">
          <TextArea label="Allowed file types" hideLabel rows={3} value={types} onChange={setTypes} error={errors.allowedExtensions} placeholder="pdf, docx, png" />
        </Setting>
        <Setting title="Malware scanning" text="Set where the application is installed, not here.">
          <span className="adm-fixed">
            {!data.scanner || data.scanner === 'none' ? 'No scanner is installed: files are accepted without a scan and marked “Not scanned”.' : `Every file is checked by “${data.scanner}” before it is accepted.`}
          </span>
        </Setting>
        <div className="form-actions adm-setting-actions">
          <Button disabled={!dirty} onClick={() => { setMaxMb(start.maxMb); setTypes(start.types); setErrors({}); setFormError(''); }}>Undo changes</Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={busy}>Save file settings</Button>
        </div>
      </form>
    </Card>
  );
}
