// Mail through Microsoft Graph (E14-25), for a Microsoft 365 tenant that has switched off SMTP
// sign-in with a password.
//
// An app registration in the tenant signs in as itself (the client-credentials grant), with a
// client secret or, better, a certificate, and sends as one named mailbox. It needs the
// application permission Mail.Send (and Mail.ReadWrite to read a mailbox for email to ticket)
// with administrator consent; an application access policy or RBAC for Applications in Exchange
// Online should limit it to the mailboxes it uses. The message goes as MIME, so every header the
// application sets reaches the recipient.
import { randomUUID } from 'node:crypto';
import {
  bareAddress, cacheKey, cachedToken, CloudError, cloudFetch, composeMime, forgetToken, microsoftEndpoints, readCertificate, signJwt,
  throttledText, type CloudAnswer, type MicrosoftCloud,
} from './cloud.ts';
import type { InboundMailbox } from './mailbox.ts';
import { registerMailProvider, type MailConfig, type MailResult } from './provider.ts';

export interface GraphSettings {
  tenantId: string;
  clientId: string;
  authMethod: 'secret' | 'certificate';
  /** The mailbox messages are sent as; empty = the from address. */
  mailbox: string;
  cloud: MicrosoftCloud;
  /** Shown in settings for a certificate: its SHA-1 thumbprint and expiry. */
  thumbprint?: string;
  certExpires?: string;
}

export const GRAPH_DEFAULTS: GraphSettings = { tenantId: '', clientId: '', authMethod: 'secret', mailbox: '', cloud: 'global' };
/** Graph takes a request of at most 4 MB; the MIME message is sent base64-encoded. */
export const GRAPH_MAX_REQUEST = 4 * 1024 * 1024;

export const graphSettings = (config: Pick<MailConfig, 'provider_settings'>): GraphSettings =>
  ({ ...GRAPH_DEFAULTS, ...((config.provider_settings?.graph ?? {}) as Partial<GraphSettings>) });

const TOKEN_ERRORS: Record<string, string> = {
  '90002': 'The directory (tenant) ID was not found. Copy it from the app registration\'s Overview page.',
  '900023': 'The directory (tenant) ID is not valid. Copy it from the app registration\'s Overview page.',
  '700016': 'The application (client) ID is not registered in this directory. Check the client ID and the tenant ID.',
  '7000215': 'The client secret is wrong. Enter the secret\'s Value, not its Secret ID.',
  '7000222': 'The client secret has expired. Create a new one under Certificates & secrets and enter it here.',
  '700027': 'The certificate was not accepted. Upload this certificate to the app registration under Certificates & secrets.',
  '700024': 'The signed sign-in request was out of date. Check the clock on this server.',
  '7000112': 'The application is disabled in this directory.',
  '53003': 'A Conditional Access policy blocked the application.',
};

function tokenError(a: CloudAnswer): CloudError {
  if (a.status === 429) return new CloudError(throttledText(a.headers), true, 429);
  const desc = String(a.json?.error_description ?? a.json?.error ?? '').split(/\r?\n/)[0].slice(0, 300);
  const code = /AADSTS(\d+)/.exec(desc)?.[1];
  const why = (code && TOKEN_ERRORS[code]) || desc || `the sign-in service answered ${a.status}`;
  return new CloudError(`Microsoft sign-in failed: ${why}${code && TOKEN_ERRORS[code] ? ` (AADSTS${code})` : ''}`, a.status >= 500, a.status);
}

/** A Graph error answer in words an administrator can act on. */
export function graphError(a: CloudAnswer, mailbox: string, purpose: 'send' | 'read'): CloudError {
  const code = String(a.json?.error?.code ?? '');
  const msg = String(a.json?.error?.message ?? '').split(/\r?\n/)[0].slice(0, 300);
  const detail = `(${code || a.status}${msg ? `: ${msg}` : ''})`;
  if (a.status === 429 || a.status === 503 || a.status === 504 || /throttl|concurrency|TooManyRequests/i.test(code)) return new CloudError(throttledText(a.headers), true, a.status);
  if (code === 'ErrorSendAsDenied') {
    return new CloudError(`The mailbox ${mailbox} may not send as the from address. Use the mailbox's own address as the from address, or give it Send As permission. ${detail}`, false, a.status);
  }
  if (a.status === 403 || code === 'ErrorAccessDenied' || code === 'Authorization_RequestDenied' || code === 'AccessDenied') {
    const perm = purpose === 'send' ? 'Mail.Send' : 'Mail.ReadWrite';
    return new CloudError(`Permission missing: the app may not ${purpose === 'send' ? 'send as' : 'read'} ${mailbox}. Grant the ${perm} application permission on Microsoft Graph and grant administrator consent; if an application access policy or RBAC for Applications limits the app, include this mailbox. ${detail}`, false, a.status);
  }
  if (a.status === 404 || code === 'ErrorInvalidUser' || code === 'MailboxNotEnabledForRESTAPI' || code === 'ResourceNotFound') {
    return new CloudError(`Wrong mailbox: ${mailbox} was not found in this tenant or has no Exchange Online mailbox. Use the address of a user or shared mailbox. ${detail}`, false, a.status);
  }
  if (a.status === 401) return new CloudError(`Microsoft Graph refused the access token. Check that the permissions have administrator consent. ${detail}`, false, 401);
  if (a.status === 413) return new CloudError(`The message is too large for Microsoft Graph. ${detail}`, false, 413);
  if (a.status >= 500) return new CloudError(`Microsoft Graph had a problem (${a.status}); the message will be tried again. ${detail}`, true, a.status);
  return new CloudError(`Microsoft Graph answered ${a.status}. ${detail}`, false, a.status);
}

export function asMailResult(err: unknown): MailResult {
  if (err instanceof CloudError) return { ok: false, retryable: err.retryable, error: err.message };
  return { ok: false, retryable: false, error: (err as Error)?.message ?? String(err) };
}

const enc = encodeURIComponent;

/** Signs in as the app (token cached until shortly before it expires) and calls Graph; a refused token is replaced once. */
export function graphClient(s: GraphSettings, credential: string) {
  const ep = microsoftEndpoints(s.cloud);
  const key = cacheKey('graph', ep.login, ep.graph, s.tenantId, s.clientId, s.authMethod, credential);
  const token = () => cachedToken(key, async () => {
    const tokenUrl = `${ep.login}/${enc(s.tenantId)}/oauth2/v2.0/token`;
    const form: Record<string, string> = { client_id: s.clientId, scope: `${ep.graph}/.default`, grant_type: 'client_credentials' };
    if (s.authMethod === 'certificate') {
      let cert;
      try { cert = readCertificate(credential); } catch (err) { throw new CloudError((err as Error).message, false); }
      const now = Math.floor(Date.now() / 1000);
      form.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
      form.client_assertion = signJwt({ x5t: cert.x5t }, { aud: tokenUrl, iss: s.clientId, sub: s.clientId, jti: randomUUID(), nbf: now - 60, iat: now, exp: now + 600 }, cert.key);
    } else {
      form.client_secret = credential;
    }
    const a = await cloudFetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }, 'The Microsoft sign-in service');
    if (a.status !== 200 || typeof a.json?.access_token !== 'string') throw tokenError(a);
    return { token: a.json.access_token, expiresIn: Number(a.json.expires_in) };
  });
  async function call(method: string, path: string, opts: { body?: string; contentType?: string } = {}): Promise<CloudAnswer> {
    for (let attempt = 0; ; attempt++) {
      const a = await cloudFetch(`${ep.graph}/v1.0${path}`, {
        method, headers: { authorization: `Bearer ${await token()}`, ...(opts.contentType ? { 'content-type': opts.contentType } : {}) }, body: opts.body,
      }, 'Microsoft Graph');
      if (a.status === 401 && attempt === 0) { forgetToken(key); continue; }
      return a;
    }
  }
  return { token, call };
}

registerMailProvider('graph', (config, secret) => {
  const s = graphSettings(config);
  const mailbox = s.mailbox || bareAddress(config.from_address);
  const missing = (): MailResult | null => {
    if (!s.tenantId || !s.clientId) return { ok: false, retryable: false, error: 'Enter the tenant ID and client ID for Microsoft Graph.' };
    if (!secret) return { ok: false, retryable: false, error: `No ${s.authMethod === 'certificate' ? 'certificate' : 'client secret'} is saved for Microsoft Graph.` };
    return null;
  };
  return {
    name: 'graph',
    async send(m) {
      const problem = missing();
      if (problem) return problem;
      try {
        const { raw, messageId } = await composeMime(m);
        const body = raw.toString('base64');
        if (body.length > GRAPH_MAX_REQUEST) {
          return { ok: false, retryable: false, error: `The message is ${(raw.length / 1024 / 1024).toFixed(1)} MB with its files; Microsoft Graph takes at most about 3 MB in one message. Send large files as links, or use SMTP.` };
        }
        const a = await graphClient(s, secret!).call('POST', `/users/${enc(mailbox)}/sendMail`, { body, contentType: 'text/plain' });
        if (a.status === 202 || a.status === 200) return { ok: true, messageId };
        throw graphError(a, mailbox, 'send');
      } catch (err) {
        return asMailResult(err);
      }
    },
    async verify() {
      const problem = missing();
      if (problem) return problem;
      try {
        await graphClient(s, secret!).token();
        return { ok: true };
      } catch (err) {
        return asMailResult(err);
      }
    },
  };
});

/** A mailbox read through Graph for email to ticket: unread messages in the inbox. */
export function graphMailbox(s: GraphSettings, credential: string, mailbox: string): InboundMailbox {
  const c = graphClient(s, credential);
  const base = `/users/${enc(mailbox)}`;
  const ok = (a: CloudAnswer) => {
    if (a.status >= 200 && a.status < 300) return a;
    throw graphError(a, mailbox, 'read');
  };
  return {
    async list() {
      const a = ok(await c.call('GET', `${base}/mailFolders/inbox/messages?$filter=${enc('isRead eq false')}&$select=id&$top=50`));
      const rows: { id: string }[] = Array.isArray(a.json?.value) ? a.json.value : [];
      return rows.filter((r) => typeof r.id === 'string').map((r, i) => ({ number: i + 1, uid: `graph:${r.id}`, size: 0, ref: r.id }));
    },
    async retrieve(item, maxBytes) {
      const a = ok(await c.call('GET', `${base}/messages/${enc(item.ref!)}/$value`));
      if (maxBytes && a.body.length > maxBytes) throw new CloudError('The message is too large to read.', false);
      return a.body;
    },
    async delete(item) {
      ok(await c.call('POST', `${base}/messages/${enc(item.ref!)}/move`, { body: JSON.stringify({ destinationId: 'deleteditems' }), contentType: 'application/json' }));
    },
    async keep(item) {
      ok(await c.call('PATCH', `${base}/messages/${enc(item.ref!)}`, { body: JSON.stringify({ isRead: true }), contentType: 'application/json' }));
    },
    async quit() { /* nothing open */ },
    close() { /* nothing open */ },
  };
}
