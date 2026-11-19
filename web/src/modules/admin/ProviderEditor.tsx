// Add or change one sign-in provider (OpenID Connect): connection, claims, role mapping and
// just-in-time accounts. Opened from Administration > Sign-in providers.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Checkbox, ChoicesField, Drawer, errorMessage, IconButton, Select, TextArea, TextField,
} from '../../core';
import { Notice } from './common';
import { redirectAddress, type Provider, type ProviderConfig, type ProvidersResponse, type TestResult } from './Providers';
import { adminApi } from './reauth';
import { Switch } from './Switch';

const TOKEN_AUTH = [
  { value: 'client_secret_basic', label: 'Client secret, sent in the Authorization header (most providers)' },
  { value: 'client_secret_post', label: 'Client secret, sent in the form' },
  { value: 'none', label: 'No secret: a public client protected by PKCE alone' },
];
const ALGORITHMS = [
  { value: 'RS256', label: 'RS256 (RSA)' }, { value: 'ES256', label: 'ES256 (elliptic curve P-256)' }, { value: 'PS256', label: 'PS256 (RSA-PSS)' },
];
const DETAIL_LABELS: Record<string, string> = {
  issuer: 'Issuer', authorizationEndpoint: 'Sign-in address', tokenEndpoint: 'Token address', jwksUri: 'Key set address',
  signingAlgorithms: 'Signs ID tokens with', keys: 'Signing keys', pkce: 'Offers PKCE (S256)',
};
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function ProviderEditor({ provider, data, onClose, onSaved }: {
  provider: Provider | null; data: ProvidersResponse; onClose: () => void; onSaved: () => void;
}) {
  const c = provider?.config;
  const [name, setName] = useState(provider?.name ?? '');
  const [key, setKey] = useState(provider?.key ?? '');
  const [enabled, setEnabled] = useState(provider?.enabled ?? false);
  const [isDefault, setIsDefault] = useState(provider?.isDefault ?? false);
  const [issuer, setIssuer] = useState(c?.issuer ?? 'https://');
  const [clientId, setClientId] = useState(c?.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [tokenAuth, setTokenAuth] = useState<string>(c?.tokenAuth ?? 'client_secret_basic');
  const [scopes, setScopes] = useState(c?.scopes ?? 'openid email profile');
  const [algorithms, setAlgorithms] = useState<string[]>(c?.algorithms ?? ['RS256', 'ES256', 'PS256']);
  const [extra, setExtra] = useState(Object.entries(c?.extraParams ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [emailClaim, setEmailClaim] = useState(c?.emailClaim ?? 'email');
  const [trustEmail, setTrustEmail] = useState(c?.trustEmail ?? false);
  const [nameClaim, setNameClaim] = useState(c?.nameClaim ?? 'name');
  const [mappingEnabled, setMappingEnabled] = useState(c?.mappingEnabled ?? false);
  const [groupsClaim, setGroupsClaim] = useState(c?.groupsClaim ?? '');
  const [mappings, setMappings] = useState<{ value: string; role: string }[]>(c?.mappings?.length ? c.mappings : []);
  const [jitEnabled, setJitEnabled] = useState(c?.jitEnabled ?? false);
  const [domains, setDomains] = useState((c?.jitDomains ?? []).join('\n'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<TestResult | null>(null);
  const err = (k: string) => errors[k] || errors[`config.${k}`] || undefined;
  const roleOptions = data.roles.map((r) => ({ value: r.key, label: `${r.name}${r.enabled ? '' : ' (switched off)'}` }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name. It is shown on the sign-in button.';
    if (!provider && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(key)) found.key = 'Use 3 to 40 lower-case letters, numbers and dashes.';
    if (!/^https?:\/\/./.test(issuer.trim())) found.issuer = 'Enter the issuer address the provider gives you.';
    if (!clientId.trim()) found.clientId = 'Enter the client ID.';
    const extraParams: Record<string, string> = {};
    for (const l of lines(extra)) {
      const at = l.indexOf('=');
      if (at < 1) { found.extraParams = 'Write one name=value pair to a line.'; break; }
      extraParams[l.slice(0, at).trim()] = l.slice(at + 1).trim();
    }
    const rules = mappings.filter((m) => m.value.trim() || m.role);
    if (rules.some((m) => !m.value.trim() || !m.role)) found.mappings = 'Give each rule a group value and a role, or remove it.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = {
      name: name.trim(), enabled, isDefault,
      config: {
        issuer: issuer.trim(), clientId: clientId.trim(), tokenAuth, scopes, algorithms, extraParams, emailClaim: emailClaim.trim(), trustEmail,
        nameClaim: nameClaim.trim(), mappingEnabled, groupsClaim: groupsClaim.trim(), mappings: rules.map((m) => ({ value: m.value.trim(), role: m.role })),
        jitEnabled, jitDomains: lines(domains),
      },
    };
    if (!provider) { body.key = key; body.type = 'oidc'; }
    if (secret) body.secret = secret;
    setBusy(true);
    try {
      if (provider) await adminApi.patch(`/api/admin/identity-providers/${provider.id}`, body);
      else await adminApi.post('/api/admin/identity-providers', body);
      onSaved();
    } catch (error) {
      const fields = error instanceof ApiError ? error.fields : {};
      setErrors(fields);
      setFormError(Object.keys(fields).length ? 'Check the highlighted fields.' : errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!provider) return;
    setTesting(true);
    setTested(null);
    try {
      setTested(await api.post<TestResult>(`/api/admin/identity-providers/${provider.id}/test`));
    } catch (error) {
      setTested({ ok: false, message: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Drawer open size="lg" title={provider ? `Edit ${provider.name}` : 'Add a sign-in provider'} onClose={onClose}>
      <form className="form adm-provider-form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <fieldset className="adm-fieldset">
          <legend className="adm-legend">About</legend>
          <TextField label="Name" required maxLength={60} value={name} onChange={setName} error={err('name')} hint="Shown on the sign-in button: Sign in with …" />
          {!provider && (
            <TextField label="Short name" required maxLength={40} value={key} onChange={(v) => setKey(v.toLowerCase())} error={err('key')} hint="Lower-case letters, numbers and dashes. Part of the redirect address; it cannot be changed later." />
          )}
          <div className="adm-copy">
            <span className="field-label">Redirect address to register with the provider</span>
            <code className="adm-code-block adm-break">{redirectAddress(data, provider?.key ?? key)}</code>
          </div>
          <Switch label="Switched on: show the button and allow sign-in" checked={enabled} onChange={setEnabled} />
          <Checkbox label="Default provider" checked={isDefault} onChange={setIsDefault} hint="Its button comes first and is the most prominent. Only a switched-on provider can be the default." />
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">Connection</legend>
          <TextField label="Issuer" required type="url" value={issuer} onChange={setIssuer} error={err('issuer')}
            hint="Exactly as the provider states it; the discovery document is read from <issuer>/.well-known/openid-configuration. A government or sovereign cloud tenant has its own sign-in host: use that." />
          <TextField label="Client ID" required value={clientId} onChange={setClientId} error={err('clientId')} hint="The identifier the provider gave this application when you registered it." />
          <Select label="Client authentication" required value={tokenAuth} onChange={setTokenAuth} options={TOKEN_AUTH} error={err('tokenAuth')} />
          {tokenAuth !== 'none' && (
            <TextField
              label="Client secret" type="password" autoComplete="new-password" value={secret} onChange={setSecret} error={err('secret')}
              hint={provider?.hasSecret ? 'A secret is stored (encrypted). Leave empty to keep it; type a new one to replace it.' : 'Stored encrypted with the application key. It is never shown again.'}
            />
          )}
          <TextField label="Scopes" value={scopes} onChange={setScopes} error={err('scopes')} hint="Separated by spaces. openid is always included." />
          <ChoicesField label="Accepted signature algorithms" value={algorithms} onChange={setAlgorithms} options={ALGORITHMS} error={err('algorithms')} />
          <TextArea label="Extra sign-in parameters" rows={2} value={extra} onChange={setExtra} error={err('extraParams')}
            hint="Optional, one name=value to a line, for example a domain hint. Security parameters cannot be overridden." />
          {provider && (
            <div className="stack adm-test-box">
              <div className="row">
                <Button icon="refresh" loading={testing} onClick={() => void test()}>Test connection</Button>
                <span className="muted adm-small">Reads the saved issuer's discovery document and key set now. Nothing else is fetched until the provider is switched on.</span>
              </div>
              {tested && (
                <Notice tone={tested.ok ? 'success' : 'danger'} role="status">
                  <p>{tested.message}</p>
                  {tested.details && (
                    <dl className="adm-test-facts">
                      {Object.entries(tested.details).map(([k, v]) => (
                        <div key={k}>
                          <dt>{DETAIL_LABELS[k] ?? k}</dt>
                          <dd className="adm-break">{Array.isArray(v) ? v.join(', ') || 'Not stated' : v === true ? 'Yes' : v === false ? 'No' : String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </Notice>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">Who the person is</legend>
          <TextField label="Email claim" value={emailClaim} onChange={setEmailClaim} error={err('emailClaim')}
            hint="Usually email. Some cloud directories put the address in preferred_username or upn instead." />
          <Checkbox label="Treat the provider's email address as verified" checked={trustEmail} onChange={setTrustEmail}
            hint="Only for a directory that controls every address it issues but does not send email_verified. Matching accounts by email relies on it." />
          <TextField label="Name claim" value={nameClaim} onChange={setNameClaim} error={err('nameClaim')} hint="Used for the display name of an account created at first sign-in." />
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">Role mapping</legend>
          <Switch label="Give roles from the provider's groups" checked={mappingEnabled} onChange={setMappingEnabled} />
          <p className="muted adm-small">Off by default. When on, each rule's role follows the group at every sign-in: added when the person is in the group, taken away when they are not. Roles without a rule are never touched.</p>
          {mappingEnabled && (
            <>
              <TextField label="Groups claim" required value={groupsClaim} onChange={setGroupsClaim} error={err('groupsClaim')} hint="The claim that lists groups or roles, for example groups or roles. Ask the provider to include it in the ID token." />
              <div className="adm-mapping" role="group" aria-label="Mapping rules">
                {mappings.map((m, i) => (
                  <div key={i} className="adm-mapping-row">
                    <TextField label={`Group value ${i + 1}`} hideLabel placeholder="Group value" value={m.value} onChange={(v) => setMappings((all) => all.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
                    <span aria-hidden="true" className="muted">gives</span>
                    <Select label={`Role for rule ${i + 1}`} hideLabel placeholder="Role" value={m.role} options={roleOptions} onChange={(v) => setMappings((all) => all.map((x, j) => (j === i ? { ...x, role: v } : x)))} />
                    <IconButton icon="trash" label={`Remove rule ${i + 1}`} onClick={() => setMappings((all) => all.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {err('mappings') && <p className="field-error" role="alert">{err('mappings')}</p>}
                <div><Button size="sm" icon="plus" onClick={() => setMappings((all) => [...all, { value: '', role: '' }])}>Add rule</Button></div>
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">New people</legend>
          <Switch label="Create an account at first sign-in" checked={jitEnabled} onChange={setJitEnabled} />
          <p className="muted adm-small">Off by default: an administrator adds people. When on, someone the provider vouches for, with a verified email in one of these domains, gets an account at first sign-in, with only the roles the mapping gives.</p>
          {jitEnabled && (
            <TextArea label="Allowed email domains" required rows={2} value={domains} onChange={setDomains} error={err('jitDomains')} hint="One to a line, for example example.org. Subdomains must be listed separately." />
          )}
        </fieldset>

        <p className="field-hint">Saving asks for your password if you have not given it in the last few minutes.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{provider ? 'Save provider' : 'Add provider'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

export type { ProviderConfig };
