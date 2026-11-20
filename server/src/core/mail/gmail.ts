// Mail through the Gmail API (E14-25), for a Google Workspace domain.
//
// Sign-in is a service account with domain-wide delegation: the application signs a short-lived
// request with the service account's key and acts as one named mailbox, for one scope at a time
// (gmail.send to send; gmail.modify to read and tidy the email-to-ticket mailbox). This was
// chosen over a person's OAuth refresh token because it needs no browser sign-in, belongs to no
// one person (it does not stop working when someone leaves or changes their password), and a
// Workspace administrator grants and withdraws it, scope by scope, in the Admin console. A
// personal Gmail account cannot use it; use SMTP with an app password there.
import { CloudError, cacheKey, cachedToken, cloudFetch, composeMime, forgetToken, googleEndpoints, bareAddress, readServiceAccountKey, signJwt, throttledError, type CloudAnswer } from './cloud.ts';
import { asMailResult } from './graph.ts';
import type { InboundMailbox } from './mailbox.ts';
import { registerMailProvider, type MailConfig, type MailResult } from './provider.ts';

export interface GmailSettings {
  /** The mailbox messages are sent as; empty = the from address. */
  mailbox: string;
  /** From the saved key, shown in settings. */
  clientEmail?: string;
  clientId?: string;
  keyId?: string;
}

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export const gmailSettings = (config: Pick<MailConfig, 'provider_settings'>): GmailSettings =>
  ({ mailbox: '', ...((config.provider_settings?.gmail ?? {}) as Partial<GmailSettings>) });

function tokenError(a: CloudAnswer, mailbox: string, scope: string, clientId: string): CloudError {
  if (a.status === 429) return throttledError(a.headers, 429);
  const err = String(a.json?.error ?? '');
  const desc = String(a.json?.error_description ?? '').slice(0, 300);
  if (err === 'unauthorized_client') {
    return new CloudError(`Domain-wide delegation is missing: in the Google Admin console (Security > Access and data control > API controls > Domain-wide delegation), add client ID ${clientId || '(the service account\'s client ID)'} with the scope ${scope}.`, false, a.status);
  }
  if (err === 'invalid_grant' && /email|user|subject/i.test(desc)) {
    return new CloudError(`Wrong mailbox: ${mailbox} is not a user in your Google Workspace domain (${desc || err}).`, false, a.status);
  }
  if (err === 'invalid_grant') return new CloudError(`Google refused the signed request (${desc || err}). Check that the key has not been deleted and that this server's clock is right.`, false, a.status);
  if (err === 'invalid_client') return new CloudError('The service account key was not accepted: it may have been deleted or the account disabled. Create a new key.', false, a.status);
  return new CloudError(`Google sign-in failed: ${desc || err || `status ${a.status}`}`, a.status >= 500, a.status);
}

export function gmailError(a: CloudAnswer, mailbox: string, purpose: 'send' | 'read'): CloudError {
  const reason = String(a.json?.error?.errors?.[0]?.reason ?? a.json?.error?.status ?? '');
  const msg = String(a.json?.error?.message ?? '').split(/\r?\n/)[0].slice(0, 300);
  const detail = `(${reason || a.status}${msg ? `: ${msg}` : ''})`;
  if (a.status === 429 || /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/.test(reason)) return throttledError(a.headers, a.status);
  if (a.status >= 500) return new CloudError(`The Gmail API had a problem (${a.status}); the message will be tried again. ${detail}`, true, a.status);
  if (a.status === 403) {
    return new CloudError(`Permission missing: the service account may not ${purpose === 'send' ? 'send as' : 'read'} ${mailbox}. Check that the Gmail API is enabled in its Google Cloud project and that domain-wide delegation includes ${purpose === 'send' ? GMAIL_SEND_SCOPE : GMAIL_READ_SCOPE}. ${detail}`, false, a.status);
  }
  if (a.status === 404 || (a.status === 400 && /failedPrecondition|FAILED_PRECONDITION/i.test(reason))) {
    return new CloudError(`Wrong mailbox: ${mailbox} has no Gmail mailbox (is Gmail switched on for this user?). ${detail}`, false, a.status);
  }
  if (a.status === 401) return new CloudError(`The Gmail API refused the access token. ${detail}`, false, 401);
  return new CloudError(`The Gmail API answered ${a.status}. ${detail}`, false, a.status);
}

const enc = encodeURIComponent;

/** Acts as `mailbox` for one scope; a refused token is replaced once. */
export function gmailClient(keyText: string, mailbox: string, scope: string) {
  const ep = googleEndpoints();
  const key = cacheKey('gmail', ep.token, keyText, mailbox, scope);
  let clientId = '';
  const token = () => cachedToken(key, async () => {
    let sa;
    try { sa = readServiceAccountKey(keyText); } catch (err) { throw new CloudError((err as Error).message, false); }
    clientId = sa.clientId;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(sa.keyId ? { kid: sa.keyId } : {}, { iss: sa.clientEmail, sub: mailbox, scope, aud: ep.token, iat: now, exp: now + 3600 }, sa.key);
    const a = await cloudFetch(ep.token, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, 'The Google sign-in service');
    if (a.status !== 200 || typeof a.json?.access_token !== 'string') throw tokenError(a, mailbox, scope, clientId);
    return { token: a.json.access_token, expiresIn: Number(a.json.expires_in) };
  });
  async function call(method: string, path: string, opts: { body?: string | Buffer; contentType?: string } = {}): Promise<CloudAnswer> {
    for (let attempt = 0; ; attempt++) {
      const a = await cloudFetch(`${ep.gmail}${path}`, {
        method, headers: { authorization: `Bearer ${await token()}`, ...(opts.contentType ? { 'content-type': opts.contentType } : {}) }, body: opts.body,
      }, 'The Gmail API');
      if (a.status === 401 && attempt === 0) { forgetToken(key); continue; }
      return a;
    }
  }
  return { token, call };
}

registerMailProvider('gmail', (config, secret) => {
  const mailbox = gmailSettings(config).mailbox || bareAddress(config.from_address);
  const missing = (): MailResult | null => (secret ? null : { ok: false, retryable: false, error: 'No service account key is saved for the Gmail API.' });
  return {
    name: 'gmail',
    async send(m) {
      const problem = missing();
      if (problem) return problem;
      try {
        const { raw, messageId } = await composeMime(m);
        const a = await gmailClient(secret!, mailbox, GMAIL_SEND_SCOPE)
          .call('POST', `/upload/gmail/v1/users/${enc(mailbox)}/messages/send?uploadType=media`, { body: raw, contentType: 'message/rfc822' });
        if (a.status === 200) return { ok: true, messageId };
        throw gmailError(a, mailbox, 'send');
      } catch (err) {
        return asMailResult(err);
      }
    },
    async verify() {
      const problem = missing();
      if (problem) return problem;
      try {
        await gmailClient(secret!, mailbox, GMAIL_SEND_SCOPE).token();
        return { ok: true };
      } catch (err) {
        return asMailResult(err);
      }
    },
  };
});

/** A mailbox read through the Gmail API for email to ticket: unread messages in the inbox. */
export function gmailMailbox(keyText: string, mailbox: string): InboundMailbox {
  const c = gmailClient(keyText, mailbox, GMAIL_READ_SCOPE);
  const base = `/gmail/v1/users/${enc(mailbox)}/messages`;
  const ok = (a: CloudAnswer) => {
    if (a.status >= 200 && a.status < 300) return a;
    throw gmailError(a, mailbox, 'read');
  };
  return {
    async list() {
      const a = ok(await c.call('GET', `${base}?q=${enc('in:inbox is:unread')}&maxResults=50`));
      const rows: { id: string }[] = Array.isArray(a.json?.messages) ? a.json.messages : [];
      return rows.filter((r) => typeof r.id === 'string').map((r, i) => ({ number: i + 1, uid: `gmail:${r.id}`, size: 0, ref: r.id }));
    },
    async retrieve(item, maxBytes) {
      const a = ok(await c.call('GET', `${base}/${enc(item.ref!)}?format=raw`));
      if (typeof a.json?.raw !== 'string') throw new CloudError('The Gmail API did not return the message.', true);
      const raw = Buffer.from(a.json.raw, 'base64url');
      if (maxBytes && raw.length > maxBytes) throw new CloudError('The message is too large to read.', false);
      return raw;
    },
    async delete(item) {
      ok(await c.call('POST', `${base}/${enc(item.ref!)}/trash`));
    },
    async keep(item) {
      ok(await c.call('POST', `${base}/${enc(item.ref!)}/modify`, { body: JSON.stringify({ removeLabelIds: ['UNREAD'] }), contentType: 'application/json' }));
    },
    async quit() { /* nothing open */ },
    close() { /* nothing open */ },
  };
}
