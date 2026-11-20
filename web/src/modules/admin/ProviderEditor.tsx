// Add or change one sign-in provider: OpenID Connect or SAML 2.0 (E02-10). Connection, who the
// person is, role mapping, the provider's second factor, signing out and just-in-time accounts.
// Opened from Administration > Sign-in providers. The SAML parts are in SamlFields.tsx.
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Checkbox, ChoicesField, Drawer, errorMessage, IconButton, Select, TextArea, TextField,
} from '../../core';
import { Notice } from './common';
import { redirectAddress, type Provider, type ProviderConfig, type ProvidersResponse, type TestResult } from './Providers';
import { adminApi } from './reauth';
import {
  SamlIdentityFields, SamlIdentityProviderFields, samlInitial, SamlSecurityFields, SamlServiceProviderBox, type SamlState,
} from './SamlFields';
import { Switch } from './Switch';

const TOKEN_AUTH = [
  { value: 'client_secret_basic', label: 'Client secret, sent in the Authorization header (most providers)' },
  { value: 'client_secret_post', label: 'Client secret, sent in the form' },
  { value: 'none', label: 'No secret: a public client protected by PKCE alone' },
];
const ALGORITHMS = [
  { value: 'RS256', label: 'RS256 (RSA)' }, { value: 'ES256', label: 'ES256 (elliptic curve P-256)' }, { value: 'PS256', label: 'PS256 (RSA-PSS)' },
];
const KINDS = [
  { value: 'oidc', name: 'OpenID Connect', text: 'Most cloud directories and modern identity providers. Needs a client ID and usually a secret.' },
  { value: 'saml', name: 'SAML 2.0', text: 'For an identity provider that offers SAML only, or that your organization runs that way. Uses metadata and certificates.' },
] as const;
const DETAIL_LABELS: Record<string, string> = {
  issuer: 'Issuer', authorizationEndpoint: 'Sign-in address', tokenEndpoint: 'Token address', jwksUri: 'Key set address',
  signingAlgorithms: 'Signs ID tokens with', keys: 'Signing keys', pkce: 'Offers PKCE (S256)',
  endSessionEndpoint: 'Sign-out address', backchannelLogout: 'Back-channel sign-out',
  entityId: 'Entity ID', ssoUrl: 'Sign-in address', sloUrl: 'Sign-out address', certificates: 'Signing certificates',
};
const words = (text: string) => text.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function ProviderEditor({ provider, data, onClose, onSaved }: {
  provider: Provider | null; data: ProvidersResponse; onClose: () => void; onSaved: () => void;
}) {
  const c = provider?.config;
  const [type, setType] = useState<string>(provider?.type ?? 'oidc');
  const saml = type === 'saml';
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
  const [groupsClaim, setGroupsClaim] = useState((saml ? c?.groupsAttribute : c?.groupsClaim) ?? '');
  const [mappings, setMappings] = useState<{ value: string; role: string }[]>(c?.mappings?.length ? c.mappings : []);
  const [jitEnabled, setJitEnabled] = useState(c?.jitEnabled ?? false);
  const [domains, setDomains] = useState((c?.jitDomains ?? []).join('\n'));
  const [providerMfa, setProviderMfa] = useState(c?.providerMfa ?? false);
  const [mfaAmr, setMfaAmr] = useState((c?.mfaAmr ?? ['mfa']).join(' '));
  const [mfaAcr, setMfaAcr] = useState((c?.mfaAcr ?? []).join(' '));
  const [groupsFromUserinfo, setGroupsFromUserinfo] = useState(c?.groupsFromUserinfo ?? false);
  const [endSession, setEndSession] = useState(c?.endSession ?? false);
  const [backchannelLogout, setBackchannelLogout] = useState(c?.backchannelLogout ?? false);
  const [s, setS] = useState<SamlState>(() => samlInitial(provider));
  const [renewKey, setRenewKey] = useState(false);
  const setSaml = (patch: Partial<SamlState>) => setS((old) => ({ ...old, ...patch }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<TestResult | null>(null);
  const err = (k: string) => errors[k] || errors[`config.${k}`] || undefined;
  const roleOptions = data.roles.map((r) => ({ value: r.key, label: `${r.name}${r.enabled ? '' : ' (switched off)'}` }));

  const chooseKind = (next: string) => {
    setType(next);
    setErrors({});
    // SAML has no "email verified" statement, so a new SAML provider starts by trusting its addresses (see the hint).
    if (!provider) setTrustEmail(next === 'saml');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name. It is shown on the sign-in button.';
    if (!provider && !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(key)) found.key = 'Use 3 to 40 lower-case letters, numbers and dashes.';
    const extraParams: Record<string, string> = {};
    if (saml) {
      if (!s.idpEntityId.trim()) found.idpEntityId = 'Enter the identity provider\'s entity ID, or read its metadata above.';
      if (!/^https?:\/\/./.test(s.ssoUrl.trim())) found.ssoUrl = 'Enter the sign-in address, or read the metadata above.';
      if (!s.idpCerts.trim()) found.idpCerts = 'Add the identity provider\'s signing certificate, or read the metadata above.';
      if (endSession && !s.sloUrl.trim()) found.sloUrl = 'Enter the identity provider\'s sign-out address, or switch signing out there off.';
      if (providerMfa && !words(mfaAcr).length) found.mfaAcr = 'Name at least one AuthnContextClassRef value that shows a multi-factor sign-in.';
    } else {
      if (!/^https?:\/\/./.test(issuer.trim())) found.issuer = 'Enter the issuer address the provider gives you.';
      if (!clientId.trim()) found.clientId = 'Enter the client ID.';
      for (const l of lines(extra)) {
        const at = l.indexOf('=');
        if (at < 1) { found.extraParams = 'Write one name=value pair to a line.'; break; }
        extraParams[l.slice(0, at).trim()] = l.slice(at + 1).trim();
      }
      if (providerMfa && !words(mfaAmr).length && !words(mfaAcr).length) found.mfaAmr = 'Name at least one amr or acr value that shows a multi-factor sign-in.';
    }
    const rules = mappings.filter((m) => m.value.trim() || m.role);
    if (rules.some((m) => !m.value.trim() || !m.role)) found.mappings = 'Give each rule a group value and a role, or remove it.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) {
      setFormError('Check the highlighted fields.');
      return;
    }
    const common = {
      trustEmail, mappingEnabled, mappings: rules.map((m) => ({ value: m.value.trim(), role: m.role })),
      jitEnabled, jitDomains: lines(domains), providerMfa, mfaAcr: words(mfaAcr), endSession,
    };
    const config = saml ? {
      ...common,
      idpEntityId: s.idpEntityId.trim(), ssoUrl: s.ssoUrl.trim(), sloUrl: s.sloUrl.trim(), idpCerts: s.idpCerts,
      spEntityId: s.spEntityId.trim(), nameIdFormat: s.nameIdFormat, emailAttribute: s.emailAttribute.trim(), nameAttribute: s.nameAttribute.trim(),
      groupsAttribute: groupsClaim.trim(), signRequests: s.signRequests, wantAssertionsSigned: s.wantAssertionsSigned, encryptAssertions: s.encryptAssertions,
    } : {
      ...common,
      issuer: issuer.trim(), clientId: clientId.trim(), tokenAuth, scopes, algorithms, extraParams, emailClaim: emailClaim.trim(),
      nameClaim: nameClaim.trim(), groupsClaim: groupsClaim.trim(), mfaAmr: words(mfaAmr), groupsFromUserinfo, backchannelLogout,
    };
    const body: Record<string, unknown> = { name: name.trim(), enabled, isDefault, config };
    if (!provider) { body.key = key; body.type = type; }
    if (!saml && secret) body.secret = secret;
    if (saml && renewKey) body.newServiceProviderKey = true;
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

  const testBox = provider && (
    <div className="stack adm-test-box">
      <div className="row">
        <Button icon="refresh" loading={testing} onClick={() => void test()}>{saml ? 'Check settings' : 'Test connection'}</Button>
        <span className="muted adm-small">
          {saml ? 'Checks the saved certificates and addresses. Nothing is fetched: sign in once to try the whole exchange.'
            : 'Reads the saved issuer\'s discovery document and key set now. Nothing else is fetched until the provider is switched on.'}
        </span>
      </div>
      {tested && (
        <Notice tone={tested.ok ? 'success' : 'danger'} role="status">
          <p>{tested.message}</p>
          {tested.details && (
            <dl className="adm-test-facts">
              {Object.entries(tested.details).map(([k, v]) => (
                <div key={k}>
                  <dt>{DETAIL_LABELS[k] ?? k}</dt>
                  <dd className="adm-break">{Array.isArray(v) ? v.join('; ') || 'Not stated' : v === true ? 'Yes' : v === false ? 'No' : v === null ? 'None' : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Notice>
      )}
    </div>
  );

  return (
    <Drawer open size="lg" title={provider ? `Edit ${provider.name}` : 'Add a sign-in provider'} onClose={onClose}>
      <form className="form adm-provider-form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {!provider && (
          <fieldset className="saml-kinds">
            <legend className="adm-legend">Kind of provider</legend>
            {KINDS.map((k) => (
              <label key={k.value} className="saml-kind">
                <input type="radio" name="provider-kind" value={k.value} checked={type === k.value} onChange={() => chooseKind(k.value)} />
                <span className="saml-kind-name">{k.name}</span>
                <span className="saml-kind-text">{k.text}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="adm-fieldset">
          <legend className="adm-legend">About</legend>
          <TextField label="Name" required maxLength={60} value={name} onChange={setName} error={err('name')} hint="Shown on the sign-in button: Sign in with …" />
          {!provider && (
            <TextField label="Short name" required maxLength={40} value={key} onChange={(v) => setKey(v.toLowerCase())} error={err('key')}
              hint={`Lower-case letters, numbers and dashes. Part of the ${saml ? 'addresses given to the identity provider' : 'redirect address'}; it cannot be changed later.`} />
          )}
          {!saml && (
            <div className="adm-copy">
              <span className="field-label">Redirect address to register with the provider</span>
              <code className="adm-code-block adm-break">{redirectAddress(data, provider?.key ?? key)}</code>
            </div>
          )}
          <Switch label="Switched on: show the button and allow sign-in" checked={enabled} onChange={setEnabled} />
          <Checkbox label="Default provider" checked={isDefault} onChange={setIsDefault} hint="Its button comes first and is the most prominent. Only a switched-on provider can be the default." />
        </fieldset>

        {saml ? (
          <>
            <SamlServiceProviderBox data={data} provider={provider} keyName={provider?.key ?? key} spEntityId={s.spEntityId} renewKey={renewKey} onRenewKey={setRenewKey} />
            <fieldset className="adm-fieldset">
              <legend className="adm-legend">Identity provider</legend>
              <SamlIdentityProviderFields value={s} set={setSaml} err={err} data={data} provider={provider} />
              {testBox}
            </fieldset>
            <fieldset className="adm-fieldset">
              <legend className="adm-legend">Message security</legend>
              <SamlSecurityFields value={s} set={setSaml} />
            </fieldset>
            <fieldset className="adm-fieldset">
              <legend className="adm-legend">Who the person is</legend>
              <SamlIdentityFields value={s} set={setSaml} err={err} trustEmail={trustEmail} setTrustEmail={setTrustEmail} />
            </fieldset>
          </>
        ) : (
          <>
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
              {testBox}
            </fieldset>

            <fieldset className="adm-fieldset">
              <legend className="adm-legend">Who the person is</legend>
              <TextField label="Email claim" value={emailClaim} onChange={setEmailClaim} error={err('emailClaim')}
                hint="Usually email. Some cloud directories put the address in preferred_username or upn instead." />
              <Checkbox label="Treat the provider's email address as verified" checked={trustEmail} onChange={setTrustEmail}
                hint="Only for a directory that controls every address it issues but does not send email_verified. Matching accounts by email relies on it." />
              <TextField label="Name claim" value={nameClaim} onChange={setNameClaim} error={err('nameClaim')} hint="Used for the display name of an account created at first sign-in." />
            </fieldset>
          </>
        )}

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">Role mapping</legend>
          <Switch label="Give roles from the provider's groups" checked={mappingEnabled} onChange={setMappingEnabled} />
          <p className="muted adm-small">Off by default. When on, each rule's role follows the group at every sign-in: added when the person is in the group, taken away when they are not. Roles without a rule are never touched.</p>
          {mappingEnabled && (
            <>
              {saml ? (
                <TextField label="Groups attribute" required value={groupsClaim} onChange={setGroupsClaim} error={err('groupsAttribute')}
                  hint="The attribute (its Name) that lists groups or roles, for example groups, memberOf or the role claim URI. Ask the identity provider to release it." />
              ) : (
                <>
                  <TextField label="Groups claim" required value={groupsClaim} onChange={setGroupsClaim} error={err('groupsClaim')} hint="The claim that lists groups or roles, for example groups or roles. Ask the provider to include it in the ID token." />
                  <Checkbox
                    label="Also read groups from the provider's userinfo address" checked={groupsFromUserinfo} onChange={setGroupsFromUserinfo}
                    hint="For a provider that leaves groups out of the ID token. When a person is in too many groups to list, the userinfo address is asked anyway; if the groups still cannot be had, their roles are left as they are."
                  />
                </>
              )}
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
          <legend className="adm-legend">Second factor</legend>
          <Switch label="The provider enforces multi-factor sign-in" checked={providerMfa} onChange={setProviderMfa} />
          <p className="muted adm-small">
            Off by default. When on, a sign-in through this provider whose {saml ? 'assertion' : 'ID token'} shows a multi-factor sign-in counts as the
            second factor here, so people who must have one are not asked to set up another. One that does not show it counts for nothing.
          </p>
          {providerMfa && (saml ? (
            <TextField label="Authentication contexts that show it (AuthnContextClassRef)" value={mfaAcr} onChange={setMfaAcr} error={err('mfaAcr')}
              hint="Separated by spaces: the AuthnContextClassRef values your identity provider uses for a multi-factor sign-in, for example https://refeds.org/profile/mfa. They are also asked for at sign-in." />
          ) : (
            <>
              <TextField label="Authentication methods that show it (amr)" value={mfaAmr} onChange={setMfaAmr} error={err('mfaAmr')}
                hint="Separated by spaces. Usually mfa. Any one of them in the token's amr claim is enough." />
              <TextField label="Authentication levels that show it (acr)" value={mfaAcr} onChange={setMfaAcr} error={err('mfaAcr')}
                hint="Optional, separated by spaces: the acr values your provider uses for a multi-factor sign-in. They are also asked for at sign-in." />
            </>
          ))}
        </fieldset>

        <fieldset className="adm-fieldset">
          <legend className="adm-legend">Signing out</legend>
          <Switch label="Signing out here also signs out at the provider" checked={endSession} onChange={setEndSession} />
          {saml ? (
            <>
              <p className="muted adm-small">
                Off by default. When on, signing out sends a signed logout request to the identity provider's sign-out address, which then
                returns here. The return address is in this application's metadata. A sign-out started at the identity provider does not end
                sessions here.
              </p>
              <TextField label="Identity provider sign-out address (HTTP-Redirect binding)" type="url" value={s.sloUrl} onChange={(v) => setSaml({ sloUrl: v })} error={err('sloUrl')}
                required={endSession} hint="Its single logout service address. Read from the metadata when it offers one." />
            </>
          ) : (
            <>
              <p className="muted adm-small">
                Off by default. When on, signing out sends the browser to the provider's sign-out page, which then returns to this
                application. Register this return address with the provider:
              </p>
              <code className="adm-code-block adm-break">{`${data.callbackBase}/`}</code>
              <Switch label="Let the provider end sessions here (back-channel sign-out)" checked={backchannelLogout} onChange={setBackchannelLogout} />
              <p className="muted adm-small">
                Off by default, and only for a server installation the provider can reach. When a person signs out at the provider,
                or their directory account is disabled, the provider calls this address and their sessions here end. Register it with the provider:
              </p>
              <code className="adm-code-block adm-break">{redirectAddress(data, provider?.key ?? key).replace(/\/callback$/, '/backchannel-logout')}</code>
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
