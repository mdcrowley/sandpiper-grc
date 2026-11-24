// The SAML 2.0 parts of the sign-in provider editor (E02-10): what to give the identity provider,
// reading its metadata (pasted, uploaded or fetched; signed metadata checked against a pinned
// certificate and refreshed daily, E02-28), its addresses and certificates, and the message security
// choices. Used by ProviderEditor.tsx.
import { useId, useRef, useState } from 'react';
import { ApiError, Button, Checkbox, errorMessage, Select, StatusChip, TextArea, TextField } from '../../core';
import { CopyBox, Notice } from './common';
import type { CertificateFacts, Provider, ProvidersResponse } from './Providers';
import { adminApi } from './reauth';
import './saml.css';

export interface SamlState {
  idpEntityId: string; ssoUrl: string; sloUrl: string; idpCerts: string;
  spEntityId: string; nameIdFormat: string; emailAttribute: string; nameAttribute: string;
  signRequests: boolean; wantAssertionsSigned: boolean; encryptAssertions: boolean;
  /** E02-28: the metadata address, the certificate that signs the metadata, and the daily refresh. */
  metadataUrl: string; metadataCert: string; metadataRefresh: boolean;
}

export const NAME_ID_FORMATS = [
  { value: 'persistent', label: 'Persistent: a stable, opaque identifier (recommended)' },
  { value: 'email', label: 'Email address' },
  { value: 'unspecified', label: 'Unspecified: whatever the identity provider sends' },
];

export function samlInitial(provider: Provider | null): SamlState {
  const c = provider?.type === 'saml' ? provider.config : null;
  return {
    idpEntityId: c?.idpEntityId ?? '', ssoUrl: c?.ssoUrl ?? '', sloUrl: c?.sloUrl ?? '', idpCerts: (c?.idpCerts ?? []).join('\n'),
    spEntityId: c?.spEntityId ?? '', nameIdFormat: c?.nameIdFormat ?? 'persistent',
    emailAttribute: c?.emailAttribute ?? '', nameAttribute: c?.nameAttribute ?? '',
    signRequests: c?.signRequests ?? false, wantAssertionsSigned: c?.wantAssertionsSigned ?? false, encryptAssertions: c?.encryptAssertions ?? false,
    metadataUrl: c?.metadataUrl ?? '', metadataCert: c?.metadataCert ?? '', metadataRefresh: c?.metadataRefresh ?? false,
  };
}

/** This application's addresses for a SAML provider, as the server makes them (also before it is saved). */
export function samlAddresses(data: ProvidersResponse, provider: Provider | null, key: string, spEntityId: string) {
  if (provider?.sp) return provider.sp;
  const base = `${data.callbackBase}/api/auth/sso/${key || '<short name>'}`;
  return { acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata`, sloUrl: `${base}/slo`, entityId: spEntityId || `${base}/metadata`, certificate: null, keyReadable: true };
}

/** "Give these to your identity provider": entity ID, ACS address, metadata, certificate. */
export function SamlServiceProviderBox({ data, provider, keyName, spEntityId, renewKey, onRenewKey }: {
  data: ProvidersResponse; provider: Provider | null; keyName: string; spEntityId: string; renewKey: boolean; onRenewKey: (on: boolean) => void;
}) {
  const sp = samlAddresses(data, provider, keyName, spEntityId);
  const cert = provider?.sp?.certificate;
  return (
    <div className="saml-sp" role="group" aria-labelledby="saml-sp-title">
      <h3 id="saml-sp-title" className="saml-sp-title">Give these to your identity provider</h3>
      <p className="muted adm-small">
        Most identity providers read them from the metadata address in one step. Otherwise copy the entity ID and the assertion
        consumer service (ACS) address into its application settings, with the HTTP-POST binding.
      </p>
      {!data.callbackBase && (
        <Notice tone="danger" role="alert">
          Set the application address on the Sign-in providers page first: these addresses are made from it, and the metadata and
          sign-ins are refused until it is set.
        </Notice>
      )}
      <CopyBox label="Entity ID (audience)" value={sp.entityId} testId="saml-entity-id" />
      <CopyBox label="Assertion consumer service (ACS) address" value={sp.acsUrl} testId="saml-acs" />
      <CopyBox label="Metadata address" value={sp.metadataUrl} testId="saml-metadata-url" />
      {provider ? (
        <div className="saml-cert-row">
          <a className="saml-download" href={`/api/auth/sso/${encodeURIComponent(provider.key)}/metadata?download=1`} download>
            Download the metadata file
          </a>
          {cert && (
            <span className="muted adm-small">
              Certificate {cert.key}, until {cert.notAfter.slice(0, 10)}. SHA-256 <span className="saml-fingerprint">{cert.fingerprint}</span>
            </span>
          )}
        </div>
      ) : (
        <p className="muted adm-small">This application's own key and certificate for this provider are made when you add it; then the metadata can be downloaded.</p>
      )}
      {provider && provider.sp && !provider.sp.keyReadable && (
        <Notice tone="danger" role="alert">
          This application's key for this provider cannot be read, perhaps because the secret key was changed. Make a new one below and give the new metadata to the identity provider.
        </Notice>
      )}
      {provider && (
        <Checkbox
          label="Make a new key and certificate for this application when saving" checked={renewKey} onChange={onRenewKey}
          hint="Only when the key is lost or due for a change. Give the new metadata to the identity provider at once: until it has it, signed requests and encrypted assertions fail."
        />
      )}
    </div>
  );
}

/** The identity provider: metadata import, addresses, certificates. */
export function SamlIdentityProviderFields({ value, set, err, data, provider }: {
  value: SamlState; set: (patch: Partial<SamlState>) => void; err: (k: string) => string | undefined;
  data: ProvidersResponse; provider: Provider | null;
}) {
  const [pasted, setPasted] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'' | 'xml' | 'url'>('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();

  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<{ ok: boolean; text: string } | null>(null);
  const read = async (body: { xml: string } | { url: string }, kind: 'xml' | 'url') => {
    setBusy(kind);
    setResult(null);
    try {
      const m = await adminApi.post<{
        entityId: string; ssoUrl: string; sloUrl: string | null; certificates: string[]; wantAuthnRequestsSigned: boolean;
        nameIdFormats: string[]; certificateFacts: CertificateFacts[]; signed: boolean;
      }>('/api/admin/identity-providers/saml-metadata', { ...body, ...(value.metadataCert.trim() ? { metadataCert: value.metadataCert.trim() } : {}) });
      const pem = m.certificates.map((c) => `-----BEGIN CERTIFICATE-----\n${c.replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----`);
      set({
        idpEntityId: m.entityId, ssoUrl: m.ssoUrl, sloUrl: m.sloUrl ?? '', idpCerts: pem.join('\n'),
        ...(m.wantAuthnRequestsSigned ? { signRequests: true } : {}),
        ...(m.nameIdFormats.includes('urn:oasis:names:tc:SAML:2.0:nameid-format:persistent') ? {}
          : m.nameIdFormats.includes('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress') ? { nameIdFormat: 'email' } : {}),
        ...('url' in body ? { metadataUrl: body.url } : {}),
      });
      const expired = m.certificateFacts.filter((c) => c.expired).length;
      setResult({
        ok: true,
        text: `${m.signed ? 'The metadata signature checked out. ' : ''}Filled in from the metadata: entity ID, sign-in address${m.sloUrl ? ', sign-out address' : ''} and ${m.certificates.length} signing certificate${m.certificates.length === 1 ? '' : 's'}`
          + `${expired ? ` (${expired} expired)` : ''}${m.wantAuthnRequestsSigned ? '. It wants signed requests, so they are switched on' : ''}. Check them, then save.`,
      });
      setPasted('');
    } catch (error) {
      const fields = error instanceof ApiError ? error.fields : {};
      setResult({ ok: false, text: fields.xml ?? fields.url ?? fields.metadataCert ?? errorMessage(error) });
    } finally {
      setBusy('');
    }
  };

  const refreshNow = async () => {
    if (!provider) return;
    setRefreshing(true);
    setRefreshed(null);
    try {
      const res = await adminApi.post<{ ok: boolean; message: string }>(`/api/admin/identity-providers/${provider.id}/refresh-metadata`);
      setRefreshed({ ok: res.ok, text: `${res.message} Close and open the provider again to see the certificates.` });
    } catch (error) {
      setRefreshed({ ok: false, text: errorMessage(error) });
    } finally {
      setRefreshing(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) { setResult({ ok: false, text: 'That file is larger than 1 MB. Metadata for one identity provider is much smaller.' }); return; }
    await read({ xml: await file.text() }, 'xml');
    if (fileRef.current) fileRef.current.value = '';
  };

  const certs = provider?.type === 'saml' ? provider.idpCertificates ?? [] : [];
  return (
    <>
      <div className="saml-import">
        <h3 className="saml-sp-title">Read the identity provider's metadata</h3>
        <p className="muted adm-small">The quickest way: the fields below are filled in from it. Nothing is saved until you save the provider.</p>
        <TextArea label="Paste the metadata (XML)" rows={3} maxRows={8} value={pasted} onChange={setPasted} placeholder="<md:EntityDescriptor …>" />
        <div className="row saml-import-actions">
          <Button size="sm" icon="check" disabled={!pasted.trim()} loading={busy === 'xml' && Boolean(pasted)} onClick={() => void read({ xml: pasted }, 'xml')}>Read pasted metadata</Button>
          <input ref={fileRef} id={fileId} type="file" accept=".xml,application/xml,text/xml,application/samlmetadata+xml" className="sr-only"
            onChange={(e) => void upload(e.currentTarget.files?.[0])} />
          <Button size="sm" icon="upload" loading={busy === 'xml' && !pasted} onClick={() => fileRef.current?.click()}>Upload a metadata file</Button>
        </div>
        <div className="saml-url-row">
          <TextField label="Or fetch it from its address" type="url" value={url} onChange={setUrl} placeholder="https://idp.example.org/metadata"
            disabled={!data.outboundEnabled}
            hint={data.outboundEnabled
              ? 'Fetched once, now. The host must be on the allowed hosts list (Settings > Integrations).'
              : 'Outbound connections are switched off (Allow outbound connections, under Settings > Integrations), so this application fetches nothing. Download the file yourself and upload it.'} />
          <Button size="sm" icon="download" disabled={!data.outboundEnabled || !url.trim()} loading={busy === 'url'} onClick={() => void read({ url: url.trim() }, 'url')}>Fetch</Button>
        </div>
        {result && <Notice tone={result.ok ? 'success' : 'danger'} role={result.ok ? 'status' : 'alert'}>{result.text}</Notice>}
        <details className="saml-signed" open={Boolean(value.metadataCert || value.metadataRefresh)}>
          <summary className="adm-small">Signed metadata and a daily refresh</summary>
          <div className="stack" style={{ marginTop: 'var(--s-2)' }}>
          <p className="muted adm-small">
            For a federation or identity provider that signs its metadata. With the certificate that signs it, metadata read here must carry a valid
            signature by it, and only what the signature covers is used.
          </p>
          <TextArea label="Metadata signing certificate (optional)" rows={3} maxRows={8} value={value.metadataCert} onChange={(v) => set({ metadataCert: v })}
            error={err('metadataCert')} placeholder="-----BEGIN CERTIFICATE-----"
            hint="PEM. Get it from the federation or identity provider by a trusted route, not from the metadata itself." />
          <TextField label="Metadata address" type="url" value={value.metadataUrl} onChange={(v) => set({ metadataUrl: v })} error={err('metadataUrl')}
            placeholder="https://idp.example.org/metadata" hint="Where the daily refresh fetches it from (https)." />
          <Checkbox label="Refresh the metadata every day" checked={value.metadataRefresh} onChange={(v) => set({ metadataRefresh: v })}
            hint={`Picks up new signing certificates before a certificate change; ones the metadata stops listing are trusted for 7 more days. Signed metadata only, and only with outbound connections on and the host allowed (Settings > Integrations)${data.outboundEnabled ? '' : ', which they are not at the moment'}. Every refresh is audited.`} />
          {provider?.config.metadataCheckedAt && (
            <p className="muted adm-small" role="status">Last refresh {new Date(provider.config.metadataCheckedAt).toLocaleString('en-US')}: {provider.config.metadataStatus}</p>
          )}
          {provider?.config.metadataRefresh && provider.config.metadataUrl && provider.config.metadataCert && (
            <div className="row">
              <Button size="sm" icon="refresh" loading={refreshing} disabled={!data.outboundEnabled} onClick={() => void refreshNow()}>Refresh now</Button>
              <span className="muted adm-small">Uses the saved address and certificate.</span>
            </div>
          )}
          {refreshed && <Notice tone={refreshed.ok ? 'success' : 'danger'} role={refreshed.ok ? 'status' : 'alert'}>{refreshed.text}</Notice>}
          </div>
        </details>
      </div>

      <TextField label="Identity provider entity ID" required value={value.idpEntityId} onChange={(v) => set({ idpEntityId: v })} error={err('idpEntityId')}
        hint="Its issuer, exactly as its metadata states it. Responses from any other issuer are refused." />
      <TextField label="Sign-in address (HTTP-Redirect binding)" required type="url" value={value.ssoUrl} onChange={(v) => set({ ssoUrl: v })} error={err('ssoUrl')}
        hint="Its single sign-on service address. People are sent there to sign in." />
      <TextArea label="Signing certificates" required rows={4} maxRows={12} value={value.idpCerts} onChange={(v) => set({ idpCerts: v })} error={err('idpCerts')}
        hint="PEM, or the base64 from the metadata. Only these keys are trusted, never one sent in a message. During a certificate change, keep the old one and add the new one; remove the old one afterwards." />
      {certs.length > 0 && (
        <ul className="saml-cert-list" aria-label="Stored signing certificates">
          {certs.map((c) => (
            <li key={c.fingerprint}>
              <StatusChip size="sm" color={c.expired ? 'red' : daysLeft(c.notAfter) < 30 ? 'amber' : 'green'}
                label={c.expired ? 'Expired' : daysLeft(c.notAfter) < 30 ? `Expires in ${daysLeft(c.notAfter)} days` : `Until ${c.notAfter.slice(0, 10)}`} />
              <span className="adm-small adm-break">{c.subject || 'No subject'} · {c.key}</span>
              <span className="muted adm-small saml-fingerprint">{c.fingerprint}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const daysLeft = (iso: string) => Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000));

/** How messages are protected. */
export function SamlSecurityFields({ value, set }: { value: SamlState; set: (patch: Partial<SamlState>) => void }) {
  return (
    <>
      <p className="muted adm-small">
        Always: the assertion, or the response around it, must be signed with RSA-SHA256 or stronger by one of the certificates
        above; it must be for this application, this address and this very sign-in, in time, and is accepted once.
      </p>
      <Checkbox label="Require the assertion itself to be signed" checked={value.wantAssertionsSigned} onChange={(v) => set({ wantAssertionsSigned: v })}
        hint="Off: a signed response around the assertion is enough. Most identity providers sign the assertion anyway." />
      <Checkbox label="Sign sign-in requests" checked={value.signRequests} onChange={(v) => set({ signRequests: v })}
        hint="For an identity provider that wants signed requests (WantAuthnRequestsSigned). It needs this application's metadata, which holds the certificate." />
      <Checkbox label="Ask for encrypted assertions, and refuse unencrypted ones" checked={value.encryptAssertions} onChange={(v) => set({ encryptAssertions: v })}
        hint="The metadata then offers an encryption key. Only AES-GCM with RSA-OAEP is accepted; set the identity provider to use it." />
    </>
  );
}

/** Who the person is: name identifier and attributes. */
export function SamlIdentityFields({ value, set, err, trustEmail, setTrustEmail }: {
  value: SamlState; set: (patch: Partial<SamlState>) => void; err: (k: string) => string | undefined;
  trustEmail: boolean; setTrustEmail: (v: boolean) => void;
}) {
  return (
    <>
      <Select label="Name identifier (NameID) format" required value={value.nameIdFormat} onChange={(v) => set({ nameIdFormat: v })} options={NAME_ID_FORMATS} error={err('nameIdFormat')}
        hint="The NameID is how this application recognizes the person next time. Transient identifiers are refused: they change at every sign-in." />
      <TextField label="Email attribute" value={value.emailAttribute} onChange={(v) => set({ emailAttribute: v })} error={err('emailAttribute')}
        placeholder="email, mail or the emailaddress claim" hint="Leave empty to try the usual names. With the email address NameID format, the NameID is used when no attribute is sent." />
      <Checkbox label="Trust the email addresses this identity provider sends" checked={trustEmail} onChange={setTrustEmail}
        hint="SAML has no 'email verified' statement. Matching existing accounts by email, and creating accounts, need this; switch it on only for your organization's own directory." />
      <TextField label="Display name attribute" value={value.nameAttribute} onChange={(v) => set({ nameAttribute: v })} error={err('nameAttribute')}
        placeholder="displayName" hint="Leave empty to try the usual names, then given name and surname. Used for an account created at first sign-in." />
      <TextField label="Entity ID of this application (optional)" value={value.spEntityId} onChange={(v) => set({ spEntityId: v })} error={err('spEntityId')}
        hint="Leave empty to use the metadata address. Change it only if the identity provider already knows this application by another name." />
    </>
  );
}
