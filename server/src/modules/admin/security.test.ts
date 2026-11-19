// Account security, wave 4: the second factor at password confirmation (E01-29), recovery codes for
// people whose only factor is a passkey (E02-21), re-encrypting every stored secret after a key
// change (E02-20) and webhook address checks after name resolution (E13-08).
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, SESSION_COOKIE, secretBox } from '../../core/auth.ts';
import { makeSecretBox } from '../../core/secretbox.ts';
import { resealStoredSecrets, retiredKeyAdvice } from '../../core/secretkey-reseal.ts';
import { totpCode } from '../../core/totp.ts';
import { SoftAuthenticator } from '../../core/webauthn/softauthn.ts';
import { addressListed, addressRefusal, nonPublicAddress } from '../../core/webhooks.ts';
import { testApp } from '../../test/helpers.ts';

const ORIGIN = 'http://localhost:80'; // app.inject sends "Host: localhost:80"
const PASSWORD = 'quiet river stone lantern';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

async function call(cookie: string | undefined, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  const res = await t.app.inject({
    method, url,
    headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), 'x-grc-csrf': '1' },
    ...(method === 'GET' || method === 'DELETE' ? {} : { payload: payload ?? {} }),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body, cookie: res.cookies.find((c) => c.name === SESSION_COOKIE)?.value };
}

async function person(username: string) {
  const row = await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, password_hash) values ($1,$2,$3,'active',$4) returning id`,
    [username, `${username}@example.test`, `Person ${username}`, await hashPassword(PASSWORD)],
  );
  const login = await call(undefined, 'POST', '/api/auth/login', { username, password: PASSWORD });
  expect(login.status).toBe(200);
  return { id: row!.id, cookie: login.cookie! };
}

const audited = async (action: string, recordId: string) =>
  (await t.db.query<{ summary: string }>('select summary from audit_events where action = $1 and record_id = $2 order by id', [action, recordId])).map((r) => r.summary);

/** Turns on an authenticator app for a signed-in person; returns the key. */
async function enrollTotp(p: { id: string; cookie: string }) {
  const begin = await call(p.cookie, 'POST', '/api/auth/totp/begin');
  const secret = begin.body.secret as string;
  const ok = await call(p.cookie, 'POST', '/api/auth/totp/confirm', { code: totpCode(secret) });
  expect(ok.status).toBe(200);
  return { secret, recoveryCodes: ok.body.recoveryCodes as string[] };
}

describe('password confirmation asks for the second factor too (E01-29)', () => {
  it('needs a code from a person with an authenticator app, and refuses a wrong one', async () => {
    const p = await person('conf-totp');
    const { secret, recoveryCodes } = await enrollTotp(p);

    // The password alone is not enough any more; it is not counted as a failure.
    const first = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD });
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe('second_factor_required');
    expect(first.body.error.fields).toMatchObject({ totp: 'available' });
    expect(first.body.error.fields.passkey).toBeUndefined();

    // A wrong password is still refused first, with the usual answer.
    const wrongPassword = await call(p.cookie, 'POST', '/api/auth/confirm', { password: 'not the password at all', code: '123456' });
    expect(wrongPassword.body.error.fields.password).toBeTruthy();

    const wrongCode = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.body.error.fields.code).toMatch(/not accepted/);
    expect((await audited('reauth.failure', p.id)).some((s) => /wrong authenticator or recovery code/.test(s))).toBe(true);

    await t.db.query('update users set totp_last_step = null where id = $1', [p.id]);
    const ok = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, code: totpCode(secret) });
    expect(ok.status).toBe(200);
    expect((await audited('reauth.success', p.id)).at(-1)).toMatch(/password and authenticator code/);

    // The same code cannot be used twice; a recovery code works once.
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, code: totpCode(secret) })).status).toBe(400);
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, code: recoveryCodes[0] })).status).toBe(200);
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, code: recoveryCodes[0] })).status).toBe(400);
    expect((await audited('mfa.recovery_code_used', p.id)).at(-1)).toMatch(/confirm the password; 9 left/);
  });

  it('accepts a passkey of the person, and nobody else\'s', async () => {
    const p = await person('conf-key');
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    // Adding a key needs a recent confirmation: the sign-in just now counts.
    const opts = await call(p.cookie, 'POST', '/api/auth/webauthn/register/options');
    expect(opts.status).toBe(200);
    const reg = await call(p.cookie, 'POST', '/api/auth/webauthn/register', { name: 'Desk key', credential: auth.create(opts.body.publicKey) });
    expect(reg.status).toBe(200);

    const ask = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD });
    expect(ask.body.error).toMatchObject({ code: 'second_factor_required', fields: { passkey: 'available' } });
    const options = await call(p.cookie, 'POST', '/api/auth/webauthn/confirm/options');
    expect(options.status).toBe(200);
    expect(options.body.publicKey.allowCredentials).toHaveLength(1);
    const ok = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, webauthn: auth.get(options.body.publicKey) });
    expect(ok.status).toBe(200);
    expect((await audited('reauth.success', p.id)).at(-1)).toMatch(/password and passkey/);

    // A replayed answer (its challenge is used up) is refused and counted.
    const again = await call(p.cookie, 'POST', '/api/auth/webauthn/confirm/options');
    const answer = auth.get(again.body.publicKey);
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, webauthn: answer })).status).toBe(200);
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, webauthn: answer })).status).toBe(400);

    // Someone else's key, answering this person's challenge, is refused.
    const other = await person('conf-other');
    const otherAuth = new SoftAuthenticator({ origin: ORIGIN });
    const o = await call(other.cookie, 'POST', '/api/auth/webauthn/register/options');
    await call(other.cookie, 'POST', '/api/auth/webauthn/register', { name: 'Other key', credential: otherAuth.create(o.body.publicKey) });
    const mine = await call(p.cookie, 'POST', '/api/auth/webauthn/confirm/options');
    const forged = otherAuth.get({ ...mine.body.publicKey, allowCredentials: [] });
    const refused = await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD, webauthn: forged });
    expect(refused.status).toBe(400);
    expect(refused.body.error.fields.code).toMatch(/not accepted/);
  });

  it('keeps asking for the password alone when the person has no second factor', async () => {
    const p = await person('conf-plain');
    expect((await call(p.cookie, 'POST', '/api/auth/confirm', { password: PASSWORD })).status).toBe(200);
    expect((await call(p.cookie, 'POST', '/api/auth/webauthn/confirm/options')).status).toBe(404);
  });
});

describe('recovery codes for people whose only factor is a passkey (E02-21)', () => {
  it('offers codes with the first passkey, accepts one at sign-in, and drops them with the last key', async () => {
    const p = await person('keyonly');
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    const opts = await call(p.cookie, 'POST', '/api/auth/webauthn/register/options');
    const reg = await call(p.cookie, 'POST', '/api/auth/webauthn/register', { name: 'Only key', credential: auth.create(opts.body.publicKey) });
    expect(reg.body.offerRecoveryCodes).toBe(true);
    expect((await call(p.cookie, 'GET', '/api/auth/security')).body).toMatchObject({ totpEnabled: false, passkeys: 1, recoveryCodesLeft: 0 });

    // Made with the password, like the app's codes.
    expect((await call(p.cookie, 'POST', '/api/auth/totp/recovery-codes', { password: 'wrong wrong wrong' })).status).toBe(400);
    const made = await call(p.cookie, 'POST', '/api/auth/totp/recovery-codes', { password: PASSWORD });
    expect(made.status).toBe(200);
    const codes = made.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect((await call(p.cookie, 'GET', '/api/auth/security')).body.recoveryCodesLeft).toBe(10);

    // A second key does not offer them again.
    const opts2 = await call(p.cookie, 'POST', '/api/auth/webauthn/register/options');
    const second = await call(p.cookie, 'POST', '/api/auth/webauthn/register', { name: 'Spare key', credential: auth.create(opts2.body.publicKey) });
    expect(second.body.offerRecoveryCodes).toBe(false);

    // Sign-in: password, then the passkey is asked for; a recovery code stands in for it, once.
    const asked = await call(undefined, 'POST', '/api/auth/login', { username: 'keyonly', password: PASSWORD });
    expect(asked.status).toBe(401);
    expect(asked.body.error).toMatchObject({ code: 'mfa_required', fields: { passkey: 'required' } });
    const wrong = await call(undefined, 'POST', '/api/auth/login', { username: 'keyonly', password: PASSWORD, recoveryCode: 'AAAAA-BBBBB' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');
    const viaCode = await call(undefined, 'POST', '/api/auth/login', { username: 'keyonly', password: PASSWORD, recoveryCode: codes[0] });
    expect(viaCode.status).toBe(200);
    expect((await call(undefined, 'POST', '/api/auth/login', { username: 'keyonly', password: PASSWORD, recoveryCode: codes[0] })).status).toBe(401);
    const signedIn = (await t.db.query<{ summary: string }>(
      `select summary from audit_events where action = 'signin.success' and record_id = $1 order by id`, [p.id])).map((r) => r.summary);
    expect(signedIn.at(-1)).toMatch(/with a recovery code/);

    // Removing every key takes the codes with it.
    await t.db.query('update users set failed_attempts = 0, locked_until = null where id = $1', [p.id]);
    const list = await call(viaCode.cookie, 'GET', '/api/auth/webauthn/credentials');
    for (const c of list.body.credentials) expect((await call(viaCode.cookie, 'DELETE', `/api/auth/webauthn/credentials/${c.id}`)).status).toBe(200);
    expect((await call(viaCode.cookie, 'GET', '/api/auth/security')).body).toMatchObject({ passkeys: 0, recoveryCodesLeft: 0 });
    expect((await call(viaCode.cookie, 'POST', '/api/auth/totp/recovery-codes', { password: PASSWORD })).status).toBe(409);
  });

  it('keeps the codes when the app is turned off but a passkey remains', async () => {
    const p = await person('both');
    const { secret } = await enrollTotp(p);
    const auth = new SoftAuthenticator({ origin: ORIGIN });
    const opts = await call(p.cookie, 'POST', '/api/auth/webauthn/register/options');
    const reg = await call(p.cookie, 'POST', '/api/auth/webauthn/register', { name: 'Key', credential: auth.create(opts.body.publicKey) });
    expect(reg.body.offerRecoveryCodes).toBe(false); // the app's codes already exist
    await t.db.query('update users set totp_last_step = null where id = $1', [p.id]);
    expect((await call(p.cookie, 'POST', '/api/auth/totp/disable', { password: PASSWORD, code: totpCode(secret) })).status).toBe(200);
    expect((await call(p.cookie, 'GET', '/api/auth/security')).body).toMatchObject({ totpEnabled: false, passkeys: 1, recoveryCodesLeft: 10 });
  });
});

describe('every stored secret is re-encrypted after a key change (E02-20)', () => {
  it('finds each kind of sealed value, re-encrypts those on a retired key, and reports what cannot be read', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const old = makeSecretBox(oldKey);
    const db = t.db;
    // One value of each kind, sealed with the old key.
    const u = await person('reseal-user');
    await db.query('update users set totp_secret = $2 where id = $1', [u.id, old.encrypt('JBSWY3DPEHPK3PXP', `totp:${u.id}`)]);
    const hook = (await db.one<{ id: string }>(
      `insert into webhooks (name, url, secret, events) values ('Reseal', 'https://receiver.example.test/h', '', '["*"]'::jsonb) returning id`))!;
    await db.query('update webhooks set secret = $2 where id = $1', [hook.id, old.encrypt('webhook-signing-secret', `webhook:${hook.id}`)]);
    const idp = (await db.one<{ id: string }>(
      `insert into identity_providers (key, type, name, config) values ('reseal-idp', 'oidc', 'Reseal', '{}'::jsonb) returning id`))!;
    await db.query('update identity_providers set secret = $2 where id = $1', [idp.id, old.encrypt('client-secret', `idp:${idp.id}`)]);
    const hasMail = Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.mail_config')::text as t`))?.t);
    if (hasMail) await db.query('update mail_config set password_sealed = $1 where id = 1', [old.encrypt('smtp-password', 'mail:smtp')]);
    await db.query(
      `insert into settings (key, value) values ('attachments.storage', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ driver: 'disk', s3: { secret: old.encrypt('object-store-secret', 'attachments.s3.secret') } })],
    );
    const job = (await db.one<{ id: string }>(
      `insert into jobs (type, payload) values ('mail.send', $1::jsonb) returning id`,
      [JSON.stringify({ logId: 'log-1', sealedLink: old.encrypt('/redeem?token=abc', 'mail:link:log-1') })]))!;

    // Without the old key nothing opens: every value is reported, none is changed. (Values other tests
    // sealed with the application's own key are unreadable to these boxes too, hence 'at least'.)
    const stranger = makeSecretBox(newKey);
    const blind = await resealStoredSecrets(db, stranger, { write: true });
    const unreadable = Object.fromEntries(blind.map((c) => [c.key, c.unreadable]));
    for (const k of ['totp', 'webhook', 'idp', 's3', 'mail_link', ...(hasMail ? ['mail'] : [])]) expect(unreadable[k], k).toBeGreaterThanOrEqual(1);
    expect(retiredKeyAdvice(blind, 0)).toMatch(/cannot be read with any key supplied/);

    // With the old key as a retired one: a dry run counts, a real run re-encrypts.
    const rotated = makeSecretBox(newKey, [oldKey]);
    const dry = await resealStoredSecrets(db, rotated, { write: false });
    expect(dry.reduce((n, c) => n + c.changed, 0)).toBe(hasMail ? 6 : 5);
    expect(retiredKeyAdvice(dry, 1)).toMatch(/still use a retired key/);
    await resealStoredSecrets(db, rotated, { write: true });
    const after = await resealStoredSecrets(db, rotated, { write: false });
    expect(after.every((c) => c.changed === 0)).toBe(true);
    expect(retiredKeyAdvice(after, 1)).toMatch(/no longer needed/);

    // The new key alone now opens every value.
    const only = makeSecretBox(newKey);
    const totp = (await db.one<{ v: string }>('select totp_secret as v from users where id = $1', [u.id]))!.v;
    expect(only.decrypt(totp, `totp:${u.id}`)).toBe('JBSWY3DPEHPK3PXP');
    const wh = (await db.one<{ v: string }>('select secret as v from webhooks where id = $1', [hook.id]))!.v;
    expect(only.decrypt(wh, `webhook:${hook.id}`)).toBe('webhook-signing-secret');
    const ip = (await db.one<{ v: string }>('select secret as v from identity_providers where id = $1', [idp.id]))!.v;
    expect(only.decrypt(ip, `idp:${idp.id}`)).toBe('client-secret');
    const s3 = (await db.one<{ v: string }>(`select value->'s3'->>'secret' as v from settings where key = 'attachments.storage'`))!.v;
    expect(only.decrypt(s3, 'attachments.s3.secret')).toBe('object-store-secret');
    const link = (await db.one<{ v: string }>(`select payload->>'sealedLink' as v from jobs where id = $1`, [job.id]))!.v;
    expect(only.decrypt(link, 'mail:link:log-1')).toBe('/redeem?token=abc');
    if (hasMail) {
      const mail = (await db.one<{ v: string }>('select password_sealed as v from mail_config where id = 1'))!.v;
      expect(only.decrypt(mail, 'mail:smtp')).toBe('smtp-password');
    }
    // Nothing secret reaches the messages.
    expect(retiredKeyAdvice(blind, 0)).not.toMatch(/webhook-signing-secret|client-secret|smtp-password/);

    // Tidy up so the application's own key can open what is left for the other tests.
    await db.query('update users set totp_secret = null where id = $1', [u.id]);
    await db.query('delete from webhooks where id = $1', [hook.id]);
    await db.query('update identity_providers set secret = null, deleted_at = now() where id = $1', [idp.id]);
    await db.query(`delete from settings where key = 'attachments.storage'`);
    await db.query('delete from jobs where id = $1', [job.id]);
    if (hasMail) await db.query('update mail_config set password_sealed = null where id = 1');
  });

  it('re-encrypts at start-up through the application, audited with a count', async () => {
    const box = secretBox(t.db);
    // A webhook secret sealed with a key the application does not hold is reported, not changed.
    const hook = (await t.db.one<{ id: string }>(
      `insert into webhooks (name, url, secret, events) values ('Foreign', 'https://receiver.example.test/f', '', '["*"]'::jsonb) returning id`))!;
    await t.db.query('update webhooks set secret = $2 where id = $1', [hook.id, makeSecretBox(randomBytes(32)).encrypt('x'.repeat(20), `webhook:${hook.id}`)]);
    const { encryptStoredSecrets } = await import('../../core/auth.ts');
    await encryptStoredSecrets({ db: t.db, audit: t.ctx.audit });
    const unreadable = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'secret_key.unreadable' order by id`);
    expect(unreadable.at(-1)?.summary).toMatch(/webhook signing secrets/);
    // A webhook whose secret cannot be read is blocked at delivery with a plain reason, not a crash.
    expect(box.isCurrent((await t.db.one<{ s: string }>('select secret as s from webhooks where id = $1', [hook.id]))!.s, `webhook:${hook.id}`)).toBe(false);
    await t.db.query('delete from webhooks where id = $1', [hook.id]);
  });
});

describe('webhook addresses are checked after name resolution (E13-08)', () => {
  it('knows which addresses are not public', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1',
      'fc00::5', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::1]', 'ff02::1', 'not-an-address']) {
      expect(nonPublicAddress(a), a).toBe(true);
    }
    for (const a of ['23.0.0.5', '2a00:1450::5', '::ffff:23.0.0.5']) expect(nonPublicAddress(a), a).toBe(false);
  });

  it('allows a private address only when that exact address is on the allow-list', () => {
    expect(addressListed('10.0.0.5', '443', ['10.0.0.5'])).toBe(true);
    expect(addressListed('10.0.0.5', '443', ['10.0.0.5:443'])).toBe(true);
    expect(addressListed('10.0.0.5', '8443', ['10.0.0.5:443'])).toBe(false);
    expect(addressListed('10.0.0.5', '443', ['*.example.test', 'hooks.example.test'])).toBe(false);
    expect(addressListed('::1', '80', ['[::1]:80'])).toBe(true);
    expect(addressListed('::1', '80', ['::1'])).toBe(true);
    expect(addressRefusal('hooks.example.test', '10.0.0.5', '443', ['hooks.example.test'])).toMatch(/resolves to 10\.0\.0\.5/);
    expect(addressRefusal('hooks.example.test', '23.0.0.5', '443', ['hooks.example.test'])).toBeNull();
    expect(addressRefusal('hooks.example.test', '10.0.0.5', '443', ['hooks.example.test', '10.0.0.5'])).toBeNull();
  });

  describe('deliveries', () => {
    let server: Server;
    let port = 0;
    const received: string[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { received.push(b); res.writeHead(204); res.end(); }); });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': false, 'integrations.allowed_hosts': [] });
    });

    it('blocks a listed name that resolves to a loopback address, and sends to a listed address', async () => {
      await t.api.post('/api/auth/confirm', { password: 'a long test passphrase 1' });
      await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true, 'integrations.allowed_hosts': [`localhost:${port}`] });
      const byName = await t.api.post('/api/admin/webhooks', { name: 'By name', url: `http://localhost:${port}/hook`, events: ['*'] });
      expect(byName.status).toBe(201);
      const blocked = await t.api.post(`/api/admin/webhooks/${byName.body.id}/test`);
      expect(blocked.body.status).toBe('blocked');
      expect(blocked.body.last_error).toMatch(/resolves to .*private, loopback or reserved/);
      expect(received).toHaveLength(0);

      // The exact address on the allow-list: sent.
      await t.api.patch('/api/admin/settings', { 'integrations.allowed_hosts': [`127.0.0.1:${port}`] });
      const byAddress = await t.api.post('/api/admin/webhooks', { name: 'By address', url: `http://127.0.0.1:${port}/hook`, events: ['*'] });
      const sent = await t.api.post(`/api/admin/webhooks/${byAddress.body.id}/test`);
      expect(sent.body.status).toBe('delivered');
      expect(received).toHaveLength(1);
      await t.api.del(`/api/admin/webhooks/${byName.body.id}`);
      await t.api.del(`/api/admin/webhooks/${byAddress.body.id}`);
    });
  });
});
