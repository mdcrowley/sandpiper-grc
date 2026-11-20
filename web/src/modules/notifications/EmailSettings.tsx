// Administration > Email (/admin/email): how mail is sent (SMTP, Microsoft Graph or the Gmail API),
// a test message, templates and the delivery log.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, ErrorState, errorMessage, formatDateTime, Loading, NumberField, PageHeader, Select, StatusChip, Switch,
  Tabs, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { MailLog } from './MailLog';
import { MailTemplates } from './MailTemplates';
import { useReauth } from './reauth';
import './notifications.css';

interface GraphSettings {
  tenantId: string; clientId: string; authMethod: 'secret' | 'certificate'; mailbox: string; cloud: string;
  thumbprint: string | null; certExpires: string | null; credentialSet: boolean;
}
interface GmailSettings { mailbox: string; clientEmail: string | null; clientId: string | null; credentialSet: boolean }

export interface MailSettings {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  tlsMode: 'none' | 'starttls' | 'tls';
  username: string;
  passwordSet: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  baseUrl: string;
  updatedAt: string;
  providers: string[];
  providerLabels?: Record<string, string>;
  clouds?: { value: string; label: string }[];
  scopes?: { gmailSend: string; gmailRead: string };
  graph?: GraphSettings;
  gmail?: GmailSettings;
}

interface LogRow { status: string; error: string | null; to_address: string }

const TLS_OPTIONS = [
  { value: 'starttls', label: 'STARTTLS (port 587)' },
  { value: 'tls', label: 'TLS (port 465)' },
  { value: 'none', label: 'None (plain connection)' },
];
const AUTH_METHODS = [
  { value: 'certificate', label: 'Certificate (recommended)' },
  { value: 'secret', label: 'Client secret' },
];
const PROVIDER_HELP: Record<string, string> = {
  smtp: 'A mail server that accepts a user name and password, or a relay on your own network.',
  graph: 'Microsoft 365 or Exchange Online, through Microsoft Graph: for a tenant that has switched off SMTP sign-in with a password.',
  gmail: 'Google Workspace, through the Gmail API with a service account: for a domain that has switched off SMTP sign-in with a password.',
};
const GRAPH_DEFAULT: GraphSettings = { tenantId: '', clientId: '', authMethod: 'secret', mailbox: '', cloud: 'global', thumbprint: null, certExpires: null, credentialSet: false };
const GMAIL_DEFAULT: GmailSettings = { mailbox: '', clientEmail: null, clientId: null, credentialSet: false };

function SettingsForm({ initial, onSaved }: { initial: MailSettings; onSaved: (s: MailSettings) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const { run, dialog } = useReauth();
  const [form, setForm] = useState(initial);
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [graphCredential, setGraphCredential] = useState('');
  const [clearGraph, setClearGraph] = useState(false);
  const [gmailKey, setGmailKey] = useState('');
  const [clearGmail, setClearGmail] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const [lastTest, setLastTest] = useState<LogRow | null>(null);
  useEffect(() => { setForm(initial); }, [initial]);

  const graph = form.graph ?? GRAPH_DEFAULT;
  const gmail = form.gmail ?? GMAIL_DEFAULT;
  const labels = initial.providerLabels ?? { smtp: 'SMTP', graph: 'Microsoft Graph', gmail: 'Gmail API' };
  const set = <K extends keyof MailSettings>(key: K, value: MailSettings[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setGraph = (patch: Partial<GraphSettings>) => setForm((f) => ({ ...f, graph: { ...(f.graph ?? GRAPH_DEFAULT), ...patch } }));
  const setGmail = (patch: Partial<GmailSettings>) => setForm((f) => ({ ...f, gmail: { ...(f.gmail ?? GMAIL_DEFAULT), ...patch } }));
  const secrets = { password, clearPassword, graphCredential, clearGraph, gmailKey, clearGmail };
  const resetSecrets = () => { setPassword(''); setClearPassword(false); setGraphCredential(''); setClearGraph(false); setGmailKey(''); setClearGmail(false); };

  const save = async (patch: Partial<MailSettings> = {}) => {
    const next = { ...form, ...patch };
    setBusy(patch.enabled !== undefined ? 'toggle' : 'save');
    setErrors({});
    try {
      const saved = await run(() => api.put<MailSettings>('/api/admin/mail/settings', {
        enabled: next.enabled, provider: next.provider, host: next.host, port: next.port, tlsMode: next.tlsMode, username: next.username,
        fromAddress: next.fromAddress, fromName: next.fromName, replyTo: next.replyTo, baseUrl: next.baseUrl,
        graph: { tenantId: graph.tenantId, clientId: graph.clientId, authMethod: graph.authMethod, mailbox: graph.mailbox, cloud: graph.cloud },
        gmail: { mailbox: gmail.mailbox },
        ...(password ? { password } : {}), ...(clearPassword ? { clearPassword: true } : {}),
        ...(graphCredential ? { graphCredential } : {}), ...(clearGraph ? { clearGraphCredential: true } : {}),
        ...(gmailKey ? { gmailKey } : {}), ...(clearGmail ? { clearGmailKey: true } : {}),
      }));
      resetSecrets();
      onSaved(saved);
      toast.success(patch.enabled === undefined ? 'Email settings saved.' : saved.enabled ? 'Email switched on.' : 'Email switched off. Nothing more will be sent.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };

  const sendTest = async () => {
    setBusy('test');
    setLastTest(null);
    try {
      const res = await api.post<LogRow>('/api/admin/mail/test', { to: testTo });
      setLastTest(res);
      if (res.status === 'sent') toast.success(`Test message sent to ${res.to_address}.`);
      else toast.error(`The test was not sent: ${res.error ?? res.status}`);
    } catch (err) {
      if (err instanceof ApiError && err.fields.to) setErrors({ testTo: err.fields.to });
      else toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const dirty = JSON.stringify({ ...form, updatedAt: '' }) !== JSON.stringify({ ...initial, updatedAt: '' })
    || Object.values(secrets).some((v) => v !== '' && v !== false);
  const savedProvider = initial.provider;
  const configured = savedProvider === 'graph' ? Boolean(initial.graph?.credentialSet && initial.graph.tenantId && initial.graph.clientId)
    : savedProvider === 'gmail' ? Boolean(initial.gmail?.credentialSet) : Boolean(initial.host);
  const sendingAs = (mailbox: string) => mailbox || form.fromAddress || 'the from address';

  return (
    <div className="stack">
      {dialog}
      <Card>
        <div className="ml-form-head">
          <div className="stack" style={{ gap: 'var(--s-1)' }}>
            <span className="ml-status">
              <strong>Email</strong>
              <StatusChip color={initial.enabled ? 'green' : 'gray'} label={initial.enabled ? 'On' : 'Off'} />
              {initial.enabled && <span className="muted ml-small">through {labels[initial.provider] ?? initial.provider}</span>}
            </span>
            <span className="muted ml-small">
              {initial.enabled
                ? 'Notifications, summaries and password links are being sent by email.'
                : 'Nothing is sent by email. Notifications stay in the application, and administrators pass set-up and reset links on by hand.'}
            </span>
          </div>
          <Switch
            label="Send email"
            checked={initial.enabled}
            disabled={busy !== '' || dirty}
            onChange={(on) => void save({ enabled: on })}
          />
        </div>
        {dirty && <p className="muted ml-small">Save your changes below before switching email on or off.</p>}
      </Card>

      <form className="stack" onSubmit={submit} noValidate>
        <Card title="How messages are sent">
          <div className="form">
            <p className="muted">
              Email is a connection this application makes to another service. It is used only when switched on above, and only to the service chosen here.
              Ask whoever runs your mail service for these details.
            </p>
            <div className="form-grid">
              <Select
                label="Send through" required value={form.provider} error={errors.provider}
                options={initial.providers.map((p) => ({ value: p, label: labels[p] ?? p }))}
                onChange={(v) => set('provider', v || 'smtp')}
                hint={PROVIDER_HELP[form.provider]}
              />
            </div>
          </div>
        </Card>

        {form.provider === 'smtp' && (
          <Card title="Mail server (SMTP)">
            <div className="form-grid">
              <TextField label="Mail server" placeholder="smtp.example.org" value={form.host} onChange={(v) => set('host', v)} error={errors.host} />
              <NumberField label="Port" min={1} max={65535} value={form.port} onChange={(v) => set('port', v ?? 0)} error={errors.port} />
              <Select label="Secure connection" required hint="Use None only for a mail relay on your own network." options={TLS_OPTIONS} value={form.tlsMode} onChange={(v) => set('tlsMode', (v || 'starttls') as MailSettings['tlsMode'])} error={errors.tlsMode} />
              <TextField label="User name" autoComplete="off" hint="Leave empty if the server does not ask for a sign-in." value={form.username} onChange={(v) => set('username', v)} error={errors.username} />
              <TextField
                label="Password" type="password" autoComplete="new-password"
                placeholder={initial.passwordSet ? 'Saved. Leave empty to keep it' : ''}
                hint="Kept encrypted. It is never shown again."
                value={password} onChange={setPassword} error={errors.password}
              />
              {initial.passwordSet && (
                <div className="field">
                  <Checkbox label="Remove the saved password" checked={clearPassword} onChange={setClearPassword} />
                </div>
              )}
            </div>
          </Card>
        )}

        {form.provider === 'graph' && (
          <Card title="Microsoft Graph">
            <div className="form">
              <p className="muted">
                Register an application in Microsoft Entra ID, give it the <strong>Mail.Send</strong> application permission on Microsoft Graph
                (and <strong>Mail.ReadWrite</strong> if email to ticket reads a mailbox through it), grant administrator consent,
                and limit it to the mailboxes it uses. The installation guide walks through it.
              </p>
              <div className="form-grid">
                <Select label="Microsoft cloud" required options={initial.clouds ?? [{ value: 'global', label: 'Worldwide (including GCC)' }]} value={graph.cloud}
                  onChange={(v) => setGraph({ cloud: v || 'global' })} error={errors['graph.cloud']} />
                <TextField label="Directory (tenant) ID" autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" value={graph.tenantId}
                  onChange={(v) => setGraph({ tenantId: v })} error={errors['graph.tenantId']} hint="On the app registration's Overview page." />
                <TextField label="Application (client) ID" autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" value={graph.clientId}
                  onChange={(v) => setGraph({ clientId: v })} error={errors['graph.clientId']} />
                <Select label="Sign-in method" required options={AUTH_METHODS} value={graph.authMethod}
                  onChange={(v) => setGraph({ authMethod: (v || 'secret') as GraphSettings['authMethod'] })} error={errors['graph.authMethod']}
                  hint="A certificate cannot be read off a screen or a configuration file, and lasts longer than a secret." />
                {graph.authMethod === 'secret' ? (
                  <TextField
                    label="Client secret" type="password" autoComplete="new-password"
                    placeholder={initial.graph?.credentialSet && initial.graph.authMethod === 'secret' ? 'Saved. Leave empty to keep it' : ''}
                    hint="The secret's Value, not its Secret ID. Kept encrypted; never shown again."
                    value={graphCredential} onChange={setGraphCredential} error={errors.graphCredential}
                  />
                ) : (
                  <TextArea
                    className="form-cell-wide ml-code" label="Certificate and private key (PEM)" rows={4} maxRows={8}
                    placeholder={initial.graph?.credentialSet && initial.graph.authMethod === 'certificate' ? 'Saved. Leave empty to keep it' : '-----BEGIN CERTIFICATE-----\n…\n-----BEGIN PRIVATE KEY-----\n…'}
                    hint="Paste the certificate uploaded to the app registration and its private key (without a passphrase). Kept encrypted; never shown again."
                    value={graphCredential} onChange={setGraphCredential} error={errors.graphCredential}
                  />
                )}
                <TextField label="Send as mailbox" type="email" autoComplete="off" value={graph.mailbox} onChange={(v) => setGraph({ mailbox: v })} error={errors['graph.mailbox']}
                  hint={`Messages are sent from this mailbox. Empty: ${sendingAs('')}.`} />
              </div>
              {initial.graph?.credentialSet && (
                <div className="stack" style={{ gap: 'var(--s-1)' }}>
                  <span className="muted ml-small">
                    {initial.graph.authMethod === 'certificate' && initial.graph.thumbprint
                      ? <>Certificate saved: thumbprint <span className="ml-mono">{initial.graph.thumbprint}</span>{initial.graph.certExpires ? `, expires ${formatDateTime(initial.graph.certExpires)}` : ''}.</>
                      : 'A client secret is saved.'}
                  </span>
                  <Checkbox label="Remove the saved Microsoft Graph sign-in" checked={clearGraph} onChange={setClearGraph} />
                </div>
              )}
            </div>
          </Card>
        )}

        {form.provider === 'gmail' && (
          <Card title="Gmail API">
            <div className="form">
              <p className="muted">
                Create a service account in a Google Cloud project with the Gmail API enabled, create a JSON key for it, and in the Google Admin
                console give its client ID domain-wide delegation for{' '}
                <code className="ml-mono">{initial.scopes?.gmailSend ?? 'https://www.googleapis.com/auth/gmail.send'}</code>
                {' '}(add <code className="ml-mono">{initial.scopes?.gmailRead ?? 'https://www.googleapis.com/auth/gmail.modify'}</code> if email to ticket reads a mailbox through it).
              </p>
              <div className="form-grid">
                <TextArea
                  className="form-cell-wide ml-code" label="Service account key (JSON)" rows={4} maxRows={8}
                  placeholder={initial.gmail?.credentialSet ? 'Saved. Leave empty to keep it' : '{ "type": "service_account", … }'}
                  hint="Paste the whole key file. Kept encrypted; never shown again."
                  value={gmailKey} onChange={setGmailKey} error={errors.gmailKey}
                />
                <TextField label="Send as mailbox" type="email" autoComplete="off" value={gmail.mailbox} onChange={(v) => setGmail({ mailbox: v })} error={errors['gmail.mailbox']}
                  hint={`A user in your Google Workspace domain. Empty: ${sendingAs('')}.`} />
              </div>
              {initial.gmail?.credentialSet && (
                <div className="stack" style={{ gap: 'var(--s-1)' }}>
                  <span className="muted ml-small">
                    Key saved for <span className="ml-mono">{initial.gmail.clientEmail}</span>{initial.gmail.clientId ? <> (client ID <span className="ml-mono">{initial.gmail.clientId}</span>)</> : null}.
                  </span>
                  <Checkbox label="Remove the saved service account key" checked={clearGmail} onChange={setClearGmail} />
                </div>
              )}
            </div>
          </Card>
        )}

        <Card title="Sender">
          <div className="form">
            <div className="form-grid">
              <TextField label="From address" type="email" placeholder="grc@example.org" value={form.fromAddress} onChange={(v) => set('fromAddress', v)} error={errors.fromAddress}
                hint={form.provider === 'smtp' ? undefined : 'Use the sending mailbox\'s own address, or one it may send as.'} />
              <TextField label="From name" placeholder="Sandpiper GRC" value={form.fromName} onChange={(v) => set('fromName', v)} error={errors.fromName} />
              <TextField label="Reply-to address" type="email" hint="Optional: where replies go, such as the service desk." value={form.replyTo} onChange={(v) => set('replyTo', v)} error={errors.replyTo} />
              <TextField label="Application address" type="url" placeholder="https://grc.example.org" hint="The address people use to open the application. Links in messages start with it." value={form.baseUrl} onChange={(v) => set('baseUrl', v)} error={errors.baseUrl} />
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!dirty || busy !== ''}>Save settings</Button>
              {dirty && <Button onClick={() => { setForm(initial); resetSecrets(); setErrors({}); }}>Discard changes</Button>}
            </div>
          </div>
        </Card>
      </form>

      <Card title="Send a test message">
        <div className="stack">
          <p className="muted">
            Sends one message now through {labels[savedProvider] ?? savedProvider} with the saved settings, even while email is switched off, so you can check them first.
            If it is refused, the reason is shown here and in the delivery log.
          </p>
          <div className="ml-toolbar">
            <TextField label="Send a test to" type="email" value={testTo} onChange={setTestTo} error={errors.testTo} />
            <Button icon="upload" loading={busy === 'test'} disabled={busy !== '' || dirty || !configured} onClick={() => void sendTest()}>Send a test message</Button>
          </div>
          {dirty && <p className="muted ml-small">Save your changes first: the test uses the saved settings.</p>}
          {lastTest && (
            lastTest.status === 'sent'
              ? <p className="notice notice-success" role="status">Sent to {lastTest.to_address}. Check that it arrived.</p>
              : <p className="notice notice-warn" role="alert">Not sent: {lastTest.error ?? lastTest.status}</p>
          )}
        </div>
      </Card>
    </div>
  );
}

export function EmailSettingsPage() {
  const [search, setSearch] = useSearchParams();
  const { data, error, reload } = useFetch<MailSettings>('/api/admin/mail/settings');
  const [saved, setSaved] = useState<MailSettings | null>(null);
  const settings = saved ?? data;

  return (
    <div className="stack ml-page">
      <PageHeader title="Email" subtitle="Send notifications, daily summaries and password links by email: over SMTP, or through Microsoft Graph or the Gmail API. Off until you switch it on." />
      <Tabs
        label="Email administration"
        active={search.get('tab') ?? 'settings'}
        onChange={(key) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true })}
        tabs={[
          {
            key: 'settings', label: 'Settings',
            content: error ? <ErrorState title="The email settings could not be loaded" error={error} onRetry={reload} />
              : !settings ? <Loading lines={8} label="Loading email settings" />
              : <SettingsForm initial={settings} onSaved={setSaved} />,
          },
          { key: 'templates', label: 'Templates', content: <MailTemplates /> },
          { key: 'log', label: 'Delivery log', content: <MailLog /> },
        ]}
      />
    </div>
  );
}
