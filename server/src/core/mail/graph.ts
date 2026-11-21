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
  throttledError, type CloudAnswer, type MicrosoftCloud,
} from './cloud.ts';
import type { InboundMailbox } from './mailbox.ts';
import { registerMailProvider, type MailConfig, type MailResult, type OutgoingMessage } from './provider.ts';

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
  if (a.status === 429) return throttledError(a.headers, 429);
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
  if (a.status === 429 || a.status === 503 || a.status === 504 || /throttl|concurrency|TooManyRequests/i.test(code)) return throttledError(a.headers, a.status);
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
  if (err instanceof CloudError) {
    return { ok: false, retryable: err.retryable, error: err.message, ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}) };
  }
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

// ---------- larger messages (E14-29) ----------
//
// One `sendMail` request carries at most 4 MB. A larger message is created as a draft, each file
// is added to it (a small one in one request, a large one through an upload session in chunks),
// and the draft is sent. A draft cannot carry `Auto-Submitted` or `References` as headers (Graph
// takes only `X-` headers, at most five), so their equivalents are set instead:
//   - the message keeps its Message-ID (`internetMessageId`, writable on a draft), so replies
//     point at it as they would at a message sent the other way;
//   - `References` and `In-Reply-To` become the MAPI properties Exchange writes those headers
//     from (PidTagInternetReferences 0x1039, PidTagInReplyToId 0x1042);
//   - `X-Auto-Response-Suppress: All` (which Exchange and Outlook honor in place of
//     `Auto-Submitted`) and `X-GRC-Mail` (the application's own loop guard) stay headers.

/** Files up to this size are added to the draft in one request; larger ones through an upload session. */
export const GRAPH_INLINE_ATTACHMENT = 3 * 1024 * 1024;
/** Upload-session chunks must be multiples of 320 KiB. */
export const GRAPH_UPLOAD_CHUNK = 10 * 320 * 1024;
/** Graph takes at most five custom headers on a message. */
const GRAPH_MAX_HEADERS = 5;
/** Hosts an upload session may point at (Graph answers with an Outlook address); tests use the stand-in's host. */
const UPLOAD_HOSTS = ['.office.com', '.office365.com', '.office365.us', '.microsoft.com', '.microsoft.us', '.outlook.com'];

function nameAndAddress(s: string): { name?: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  return m ? { ...(m[1].trim() ? { name: m[1].trim() } : {}), address: m[2].trim() } : { address: s.trim() };
}

/** The draft's JSON: the message as Graph describes one, with the headers' equivalents. */
export function graphDraft(m: OutgoingMessage, messageId: string): Record<string, unknown> {
  const headers = Object.entries(m.headers ?? {});
  const value = (name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1];
  const custom = headers.filter(([k]) => /^x-/i.test(k))
    // The loop guards first, so they are never the ones left out.
    .sort(([a], [b]) => Number(!/^(x-grc-mail|x-auto-response-suppress)$/i.test(a)) - Number(!/^(x-grc-mail|x-auto-response-suppress)$/i.test(b)))
    .slice(0, GRAPH_MAX_HEADERS)
    .map(([name, v]) => ({ name, value: v }));
  const extended = [
    value('references') ? { id: 'String 0x1039', value: value('references') } : null,
    value('in-reply-to') ? { id: 'String 0x1042', value: value('in-reply-to') } : null,
  ].filter(Boolean);
  return {
    subject: m.subject,
    body: m.html ? { contentType: 'HTML', content: m.html } : { contentType: 'Text', content: m.text },
    from: { emailAddress: nameAndAddress(m.from) },
    toRecipients: [{ emailAddress: { address: m.to } }],
    ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}),
    internetMessageId: messageId,
    ...(custom.length ? { internetMessageHeaders: custom } : {}),
    ...(extended.length ? { singleValueExtendedProperties: extended } : {}),
  };
}

function uploadUrlAllowed(url: string, graphBase: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.host === new URL(graphBase).host) return true;
  return u.protocol === 'https:' && UPLOAD_HOSTS.some((h) => u.hostname.toLowerCase().endsWith(h));
}

async function sendLarge(client: ReturnType<typeof graphClient>, s: GraphSettings, mailbox: string, m: OutgoingMessage, messageId: string): Promise<MailResult> {
  const base = `/users/${enc(mailbox)}/messages`;
  const ok = (a: CloudAnswer) => {
    if (a.status >= 200 && a.status < 300) return a;
    throw graphError(a, mailbox, 'send');
  };
  const created = ok(await client.call('POST', base, { body: JSON.stringify(graphDraft(m, messageId)), contentType: 'application/json' }));
  const id = typeof created.json?.id === 'string' ? created.json.id : null;
  if (!id) throw new CloudError('Microsoft Graph did not return the draft it created.', true);
  const draft = `${base}/${enc(id)}`;
  try {
    for (const file of m.attachments ?? []) {
      const bytes = Buffer.from(file.contentBase64, 'base64');
      const contentType = file.contentType || 'application/octet-stream';
      if (bytes.length <= GRAPH_INLINE_ATTACHMENT) {
        ok(await client.call('POST', `${draft}/attachments`, {
          // A picture shown in the HTML body (the logo, E14-36) is inline, named by its Content-ID.
          body: JSON.stringify({
            '@odata.type': '#microsoft.graph.fileAttachment', name: file.filename, contentType, contentBytes: file.contentBase64,
            ...(file.cid ? { isInline: true, contentId: file.cid } : {}),
          }),
          contentType: 'application/json',
        }));
        continue;
      }
      const session = ok(await client.call('POST', `${draft}/attachments/createUploadSession`, {
        body: JSON.stringify({ AttachmentItem: { attachmentType: 'file', name: file.filename, size: bytes.length, contentType } }),
        contentType: 'application/json',
      }));
      const uploadUrl = String(session.json?.uploadUrl ?? '');
      if (!uploadUrlAllowed(uploadUrl, microsoftEndpoints(s.cloud).graph)) {
        throw new CloudError('Microsoft Graph answered with an upload address that is not a Microsoft address; the file was not sent.', false);
      }
      // The upload address carries its own authorization: no access token is sent to it.
      for (let start = 0; start < bytes.length; start += GRAPH_UPLOAD_CHUNK) {
        const chunk = bytes.subarray(start, Math.min(bytes.length, start + GRAPH_UPLOAD_CHUNK));
        const a = await cloudFetch(uploadUrl, {
          method: 'PUT', body: chunk,
          headers: { 'content-type': 'application/octet-stream', 'content-range': `bytes ${start}-${start + chunk.length - 1}/${bytes.length}` },
        }, 'The Microsoft Graph upload session');
        if (a.status !== 200 && a.status !== 201) throw graphError(a, mailbox, 'send');
      }
    }
    const sent = await client.call('POST', `${draft}/send`);
    if (sent.status !== 202 && sent.status !== 200) throw graphError(sent, mailbox, 'send');
    return { ok: true, messageId };
  } catch (err) {
    // A draft left behind would sit in the mailbox's Drafts folder; the next attempt makes a new one.
    await client.call('DELETE', draft).catch(() => undefined);
    throw err;
  }
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
        const client = graphClient(s, secret!);
        // Too large for one request (E14-29): a draft, its files uploaded one by one, then sent.
        if (body.length > GRAPH_MAX_REQUEST) return await sendLarge(client, s, mailbox, m, messageId);
        const a = await client.call('POST', `/users/${enc(mailbox)}/sendMail`, { body, contentType: 'text/plain' });
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
