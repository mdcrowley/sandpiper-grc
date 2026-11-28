// Administration > Sign-in providers, and the sign-in parts of a user's page: linked identities,
// provider limits, "may link at next sign-in" permits and the break-glass account.
import type { FastifyRequest } from 'fastify';
import { featureState, ownedOff, rolesShown } from '../../core/features.ts';
import type { Row } from '../../core/module.ts';
import type { ModuleContext } from '../../core/module.ts';
import {
  callbackPath, DRIVERS, providerById, publicBase, readSecret, sealSecret, type IdentityDeps,
} from '../../core/identity/service.ts';
import { IdentityError, type ProviderRecord } from '../../core/identity/types.ts';
import { certificateFacts, mergeRefreshedCertificates, newServiceProviderKey, ROLLOVER_DAYS, samlAddresses } from '../../core/identity/saml.ts';
import { parseIdpMetadata, verifyMetadataSignature } from '../../core/identity/samlxml.ts';
import { readCertificates } from '../../core/identity/x509.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import { fetchText } from '../../core/identity/http.ts';
import { hostAllowed } from '../../core/webhooks.ts';
import { UUID_RE } from '../../core/errors.ts';
import { adminRoute, body, idParam, invalid, sensitive } from './shared.ts';
import { identityDeps, signInMethods, unlinkIdentity } from './sso.ts';

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const pemOf = (b64: string) => `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`;
const PERMIT_DAYS = 7;

/** Active people who could not sign in if local passwords were switched off (break-glass aside). */
export async function localOffBlockers(ctx: ModuleContext): Promise<{ id: string; username: string; display_name: string }[]> {
  return ctx.db.query(
    `select u.id, u.username, u.display_name from users u
     where u.deleted_at is null and u.status = 'active'
       and not exists (select 1 from identity_user_settings s where s.user_id = u.id and s.break_glass)
       and not exists (select 1 from user_identities i join identity_providers p on p.id = i.provider_id
                       and p.deleted_at is null and p.enabled where i.user_id = u.id)
     order by lower(u.display_name) limit 200`,
  );
}

export async function breakGlassUser(ctx: ModuleContext) {
  return ctx.db.one<{ id: string; username: string; display_name: string; totp_enabled: boolean; password_changed_at: string | null }>(
    `select u.id, u.username, u.display_name, u.totp_enabled, u.password_changed_at
     from identity_user_settings s join users u on u.id = s.user_id where s.break_glass and u.deleted_at is null`,
  );
}

/** The checks for switching local passwords off: a break-glass account exists and everyone else has a provider. */
export async function localOffProblem(ctx: ModuleContext): Promise<string | null> {
  if (!(await breakGlassUser(ctx))) return 'Choose a break-glass account first: it keeps its password when the others stop.';
  const blockers = await localOffBlockers(ctx);
  if (blockers.length) {
    const names = blockers.slice(0, 5).map((b) => b.username).join(', ');
    return `${blockers.length} active ${blockers.length === 1 ? 'person has' : 'people have'} no linked sign-in provider (${names}${blockers.length > 5 ? ', …' : ''}). Link them, or disable their accounts, first.`;
  }
  return null;
}

const providerView = async (ctx: ModuleContext, r: Row, base = '') => ({
  id: r.id, key: r.key, type: r.type, name: r.name, enabled: r.enabled, isDefault: r.is_default, sort: r.sort,
  config: r.config, hasSecret: Boolean(r.secret), linked: r.linked ?? 0, createdAt: r.created_at, updatedAt: r.updated_at,
  typeLabel: DRIVERS[r.type]?.label ?? r.type,
  // SAML (E02-10): what to give the identity provider, and the certificates' facts.
  ...(r.type === 'saml' ? {
    sp: {
      ...samlAddresses(`${base}${callbackPath(r.key)}`, r.config ?? {}),
      certificate: certificateFacts([r.config?.spCert])[0] ?? null,
      keyReadable: Boolean(r.secret) && readSecret(ctx.db, toRecord(r)) !== null,
    },
    idpCertificates: certificateFacts(r.config?.idpCerts),
  } : {}),
});

export function registerProviders(ctx: ModuleContext) {
  const { db } = ctx;
  const deps: IdentityDeps = identityDeps(ctx);
  const baseOf = async (req: FastifyRequest) => { try { return await publicBase(deps, req); } catch { return ''; } };

  const listRows = () => db.query<Row>(
    `select p.*, (select count(*)::int from user_identities i where i.provider_id = p.id) as linked
     from identity_providers p where p.deleted_at is null order by p.is_default desc, p.sort, lower(p.name)`,
  );

  const getRow = async (id: string) => {
    const row = await db.one<Row>(
      `select p.*, (select count(*)::int from user_identities i where i.provider_id = p.id) as linked
       from identity_providers p where p.id = $1 and p.deleted_at is null`, [id],
    );
    if (!row) ctx.fail(404, 'not_found', 'Sign-in provider not found.');
    return row!;
  };

  adminRoute(ctx, 'GET', '/api/admin/identity-providers', async (req) => {
    let base = '';
    try { base = await publicBase(deps, req); } catch { base = ''; }
    const bg = await breakGlassUser(ctx);
    return {
      providers: await Promise.all((await listRows()).map((r) => providerView(ctx, r, base))),
      kinds: Object.values(DRIVERS).map((d) => ({ type: d.type, label: d.label })),
      // SAML metadata can be fetched from an address only when outbound connections are on (and to an allowed host).
      outboundEnabled: (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true,
      callbackBase: base,
      callbackPathTemplate: callbackPath('{key}'),
      publicUrl: await ctx.settings.get('auth.public_url', ''),
      localSignIn: (await ctx.settings.get('auth.local_signin', true)) !== false,
      localOffBlockers: await localOffBlockers(ctx),
      breakGlass: bg ?? null,
      // Roles of switched-off areas are not offered (E18-64).
      roles: rolesShown(await featureState(db), await db.query<{ key: string; name: string; enabled: boolean }>('select key, name, enabled from roles order by name')),
    };
  });

  /** Checks and applies the editable parts of a provider. Returns the column values to write. */
  async function clean(req: FastifyRequest, existing: Row | null) {
    const b = body(req);
    const fields: Record<string, string> = {};
    const warnings: string[] = [];
    const type = existing ? existing.type : String(b.type ?? 'oidc');
    const driver = DRIVERS[type];
    if (!driver) fields.type = 'Choose a kind of provider.';
    let key = existing?.key as string | undefined;
    if (!existing) {
      key = String(b.key ?? '').trim().toLowerCase();
      if (!KEY_RE.test(key)) fields.key = 'Use 3 to 40 lower-case letters, numbers and dashes. It becomes part of the redirect address and cannot change.';
      else if (await db.one('select 1 from identity_providers where key = $1', [key])) fields.key = 'Another provider (perhaps a removed one) already uses that short name.';
    }
    const name = b.name !== undefined || !existing ? String(b.name ?? '').trim() : existing.name;
    if (!name || name.length > 60) fields.name = 'Enter a name of up to 60 characters. It is shown on the sign-in button.';
    const enabled = b.enabled !== undefined ? b.enabled === true : existing?.enabled ?? false;
    const isDefault = b.isDefault !== undefined ? b.isDefault === true : existing?.is_default ?? false;
    const sort = b.sort !== undefined ? Number(b.sort) : existing?.sort ?? 100;
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) fields.sort = 'Order must be a whole number from 0 to 9999.';
    let config: Record<string, any> = existing?.config ?? {};
    if (driver) {
      const res = driver.cleanConfig((b.config ?? {}) as Record<string, unknown>, existing?.config ?? null);
      Object.assign(fields, Object.fromEntries(Object.entries(res.fields).map(([k, v]) => [`config.${k}`, v])));
      config = res.config;
      const roleRows = await db.query<{ key: string; name: string; enabled: boolean }>('select key, name, enabled from roles');
      const roleKeys = new Set(roleRows.map((r) => r.key));
      const unknown = (config.mappings ?? []).find((m: { role: string }) => !roleKeys.has(m.role));
      if (unknown) fields['config.mappings'] = `There is no role "${unknown.role}".`;
      // E46-69: a rule may name a role that gives no access (switched off under Roles, or of a switched-off
      // area): saved, with a warning, so it works once the role or area is on again.
      const mapped = new Set((config.mappings ?? []).map((m: { role: string }) => m.role));
      const st = await featureState(db);
      const off = roleRows.filter((r) => mapped.has(r.key) && !r.enabled && !ownedOff(st, 'role', r.key));
      if (off.length) warnings.push(`${off.map((r) => r.name).join(', ')} ${off.length === 1 ? 'is' : 'are'} switched off under Roles: people given ${off.length === 1 ? 'it' : 'them'} through the role mapping get no access from ${off.length === 1 ? 'it' : 'them'} until switched on.`);
      const areaOff = roleRows.filter((r) => mapped.has(r.key) && ownedOff(st, 'role', r.key));
      if (areaOff.length) warnings.push(`${areaOff.map((r) => `"${r.key}"`).join(', ')} ${areaOff.length === 1 ? 'belongs' : 'belong'} to an area that is switched off: the mapping gives no access from ${areaOff.length === 1 ? 'it' : 'them'} until the area is switched on under Administration > Features.`);
    }
    let secret: string | null | undefined; // undefined = keep
    if (type === 'saml') {
      // SAML: the stored secret is this application's own key, made here; it never comes from input.
    } else if (typeof b.secret === 'string' && b.secret !== '') {
      if (b.secret.length > 1000) fields.secret = type === 'ldap' ? 'The service account password is too long.' : 'The client secret is too long.';
      secret = b.secret;
    } else if (b.clearSecret === true) secret = null;
    if (config.tokenAuth && config.tokenAuth !== 'none' && enabled && secret === null) fields.secret = 'This provider needs a client secret while it is switched on.';
    if (config.tokenAuth && config.tokenAuth !== 'none' && enabled && secret === undefined && !existing?.secret) {
      fields.secret = 'Enter the client secret before switching the provider on.';
    }
    // E02-26: a directory's service account password is the stored secret (encrypted with the secret key).
    if (type === 'ldap' && config.bindDn && enabled && (secret === null || (secret === undefined && !existing?.secret))) {
      fields.secret = 'Enter the service account password before switching the provider on.';
    }
    if (type === 'ldap' && !config.bindDn && secret === undefined && existing?.secret) secret = null; // no service account: nothing to keep
    if (Object.keys(fields).length) invalid(fields);
    return { type, key: key!, name, enabled, isDefault: isDefault && enabled, sort, config, secret, newKey: type === 'saml' && (!existing || b.newServiceProviderKey === true), warnings };
  }

  /** SAML: a new key pair for this application's side (on adding the provider, or when asked). */
  async function samlKey(v: { type: string; name: string; config: Record<string, any>; secret: string | null | undefined; newKey: boolean }) {
    if (!v.newKey) return;
    const made = await newServiceProviderKey(`${v.name} (Sandpiper GRC)`);
    v.config = { ...v.config, spCert: made.certificate };
    v.secret = made.privateKey;
  }

  const summaryOf = (r: Row) => ({
    name: r.name, enabled: r.enabled, isDefault: r.is_default, issuer: r.config?.issuer ?? r.config?.idpEntityId, clientId: r.config?.clientId,
    ssoUrl: r.config?.ssoUrl, signingCertificates: r.type === 'saml' ? certificateFacts(r.config?.idpCerts).map((c) => c.fingerprint) : undefined,
    serviceProviderCertificate: r.type === 'saml' ? certificateFacts([r.config?.spCert])[0]?.fingerprint : undefined,
    // SAML (E02-27, E02-28): sign-outs from the identity provider, signed metadata and its refresh.
    idpLogout: r.type === 'saml' ? r.config?.idpLogout === true : undefined,
    metadataUrl: r.type === 'saml' ? r.config?.metadataUrl || undefined : undefined,
    metadataSigningCertificate: r.type === 'saml' && r.config?.metadataCert ? certificateFacts([r.config.metadataCert])[0]?.fingerprint : undefined,
    metadataRefresh: r.type === 'saml' ? r.config?.metadataRefresh === true : undefined,
    // Directory (E02-26): where, and how it is trusted. The service account's password is only ever "stored".
    directoryUrl: r.config?.url, baseDn: r.config?.baseDn, userFilter: r.config?.userFilter, serviceAccount: r.type === 'ldap' ? (r.config?.bindDn ? 'set' : 'none') : undefined,
    pinnedCaCertificate: r.type === 'ldap' ? (r.config?.caCert ? certificateFacts([r.config.caCert])[0]?.fingerprint ?? 'set' : 'none') : undefined,
    mappingEnabled: r.config?.mappingEnabled, mappings: r.config?.mappings, jitEnabled: r.config?.jitEnabled,
    jitDomains: r.config?.jitDomains, trustEmail: r.config?.trustEmail, secret: r.secret ? 'stored' : 'none',
  });

  adminRoute(ctx, 'POST', '/api/admin/identity-providers', async (req, reply) => {
    const v = await clean(req, null);
    await sensitive(ctx, req, 'adding a sign-in provider');
    await samlKey(v);
    const row = await db.tx(async (tx) => {
      if (v.isDefault) await tx.query('update identity_providers set is_default = false where is_default');
      const created = await tx.one<Row>(
        `insert into identity_providers (key, type, name, enabled, is_default, config, sort, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8) returning *`,
        [v.key, v.type, v.name, v.enabled, v.isDefault, JSON.stringify(v.config), v.sort, req.user!.id],
      );
      if (v.secret) await tx.query('update identity_providers set secret = $2 where id = $1', [created!.id, sealSecret(db, created!.id, v.secret)]);
      return created!;
    });
    const after = await getRow(row.id);
    await ctx.audit(req, {
      action: 'identity_provider.create', recordType: 'identity_provider', recordId: row.id,
      summary: `Sign-in provider "${v.name}" (${DRIVERS[v.type].label}) added${v.enabled ? ' and switched on' : ''}`, after: summaryOf(after),
    });
    reply.code(201);
    return { ...(await providerView(ctx, after, await baseOf(req))), warnings: v.warnings };
  });

  adminRoute(ctx, 'PATCH', '/api/admin/identity-providers/:id', async (req) => {
    const before = await getRow(idParam(req, 'Sign-in provider'));
    const v = await clean(req, before);
    await sensitive(ctx, req, `changing the sign-in provider "${before.name}"`);
    await samlKey(v);
    if (before.enabled && !v.enabled && !(await ctx.settings.get('auth.local_signin', true))) {
      const stillOk = await db.one(
        `select 1 from users u where u.deleted_at is null and u.status = 'active'
           and not exists (select 1 from identity_user_settings s where s.user_id = u.id and s.break_glass)
           and not exists (select 1 from user_identities i join identity_providers p on p.id = i.provider_id
             and p.deleted_at is null and p.enabled and p.id <> $1 where i.user_id = u.id) limit 1`, [before.id],
      );
      if (stillOk) invalid({ enabled: 'Local passwords are off, and some people sign in only through this provider. Switch local passwords on first.' });
    }
    await db.tx(async (tx) => {
      if (v.isDefault && !before.is_default) await tx.query('update identity_providers set is_default = false where is_default and id <> $1', [before.id]);
      await tx.query(
        `update identity_providers set name = $2, enabled = $3, is_default = $4, config = $5::jsonb, sort = $6, updated_at = now(), updated_by = $7
         where id = $1`, [before.id, v.name, v.enabled, v.isDefault, JSON.stringify(v.config), v.sort, req.user!.id],
      );
      if (v.secret !== undefined) await tx.query('update identity_providers set secret = $2 where id = $1', [before.id, v.secret === null ? null : sealSecret(db, before.id, v.secret)]);
    });
    DRIVERS[before.type]?.forget?.(toRecord(before));
    const after = await getRow(before.id);
    const [b, a] = [summaryOf(before), summaryOf(after)] as Row[];
    const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const otherChange = JSON.stringify(before.config) !== JSON.stringify(after.config) && !changed.length;
    if (changed.length || otherChange || v.secret !== undefined) {
      const switched = before.enabled !== after.enabled;
      const what = [...changed.filter((k) => k !== 'enabled'), ...(otherChange ? ['claims'] : []), ...(v.secret !== undefined && !changed.includes('secret') ? ['secret'] : [])];
      await ctx.audit(req, {
        action: switched ? (after.enabled ? 'identity_provider.enable' : 'identity_provider.disable') : 'identity_provider.update',
        recordType: 'identity_provider', recordId: before.id,
        summary: `Sign-in provider "${after.name}" ${switched ? (after.enabled ? 'switched on' : 'switched off') : 'changed'}${what.length ? ` (${what.join(', ')})` : ''}`,
        before: Object.fromEntries(changed.map((k) => [k, b[k]])), after: Object.fromEntries(changed.map((k) => [k, a[k]])),
      });
    }
    return { ...(await providerView(ctx, after, await baseOf(req))), warnings: v.warnings };
  });

  adminRoute(ctx, 'POST', '/api/admin/identity-providers/:id/test', async (req) => {
    const row = await getRow(idParam(req, 'Sign-in provider'));
    const p = toRecord(row);
    // Fetches the discovery document and key set now (OpenID Connect), or connects to the directory and
    // optionally looks one person up (E02-26), because an administrator asked; nothing else calls out.
    const username = typeof body(req).username === 'string' ? String(body(req).username).trim().slice(0, 256) : '';
    const result = await DRIVERS[p.type].test(p, readSecret(db, p), { username });
    await ctx.audit(req, {
      action: 'identity_provider.test', recordType: 'identity_provider', recordId: p.id,
      summary: `Connection to "${p.name}" tested${username ? ` (looking up "${username.slice(0, 80)}")` : ''}: ${result.ok ? 'worked' : 'failed'}. ${result.message}`.slice(0, 500),
    });
    return result;
  });

  // SAML (E02-10): read an identity provider's metadata, pasted or uploaded as text, or fetched from its
  // address when outbound connections are on and the host is allowed. Nothing is saved: the editor
  // fills its fields from the answer, and the administrator saves.
  adminRoute(ctx, 'POST', '/api/admin/identity-providers/saml-metadata', async (req) => {
    const b = body(req);
    let xml = typeof b.xml === 'string' ? b.xml : '';
    const url = typeof b.url === 'string' ? b.url.trim() : '';
    if (!xml && !url) invalid({ xml: 'Paste the metadata, upload its file, or give its address.' });
    if (!xml) {
      if ((await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) !== true) {
        ctx.fail(409, 'outbound_off', 'Outbound connections are switched off (Settings > Integrations), so metadata cannot be fetched. Download it yourself and upload the file.');
      }
      let target: URL | null = null;
      try { target = new URL(url); } catch { target = null; }
      if (!target) invalid({ url: 'Enter the metadata address, starting with https://.' });
      if (!hostAllowed(target!, await ctx.settings.get<unknown>('integrations.allowed_hosts', []))) {
        invalid({ url: `${target!.host} is not on the list of allowed hosts (integrations.allowed_hosts). Add it there, or upload the file.` });
      }
      try {
        xml = await fetchText(url, 'metadata address');
      } catch (err) {
        await ctx.audit(req, { action: 'identity_provider.metadata_fetch', summary: `SAML metadata could not be fetched from ${target!.host}: ${err instanceof IdentityError ? err.reason : 'error'}` });
        invalid({ url: err instanceof IdentityError ? err.message : 'The metadata could not be fetched.' });
      }
      await ctx.audit(req, { action: 'identity_provider.metadata_fetch', summary: `SAML metadata fetched from ${target!.host}` });
    }
    // E02-28: with a metadata signing certificate, the metadata must be signed by it, and only what the
    // signature covers is read.
    let signed = false;
    const rawCert = typeof b.metadataCert === 'string' ? b.metadataCert.trim() : '';
    try {
      if (rawCert) {
        const read = readCertificates(rawCert);
        if (read.problem || read.certs.length !== 1) invalid({ metadataCert: read.problem ?? 'Give exactly one metadata signing certificate.' });
        xml = verifyMetadataSignature(xml, read.certs[0]);
        signed = true;
      }
      const meta = parseIdpMetadata(xml);
      if (signed && meta.validUntil && Date.parse(meta.validUntil) < Date.now()) {
        throw new IdentityError('metadata out of date', `The metadata was valid until ${meta.validUntil.slice(0, 10)} and is out of date.`);
      }
      return { ...meta, signed, certificateFacts: certificateFacts(meta.certificates.map(pemOf)) };
    } catch (err) {
      if (!(err instanceof IdentityError)) throw err;
      return invalid({ [url && !b.xml ? 'url' : 'xml']: err.message || 'The metadata could not be read.' });
    }
  });

  // ---------- E02-28: refreshing SAML metadata ----------
  // Only for providers with the refresh on, only with outbound connections on and the host allowed,
  // and only signed metadata (checked against the pinned certificate). New signing certificates are
  // added; ones the metadata stops listing are kept for a few days (a rollover in progress). Each
  // change is audited; a failure is recorded on the provider and audited, and nothing changes.
  async function refreshMetadata(row: Row, req: FastifyRequest | null): Promise<{ ok: boolean; message: string }> {
    const c = row.config ?? {};
    // Only the keys the refresh owns are written, so an administrator's change made meanwhile is kept.
    const record = async (ok: boolean, message: string, changed: Record<string, unknown> = {}) => {
      await db.query('update identity_providers set config = config || $2::jsonb, updated_at = now() where id = $1',
        [row.id, JSON.stringify({ ...changed, metadataCheckedAt: new Date().toISOString(), metadataStatus: message.slice(0, 300) })]);
      return { ok, message };
    };
    if ((await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) !== true) {
      return record(false, 'Not refreshed: outbound connections are switched off.');
    }
    let target: URL;
    try { target = new URL(String(c.metadataUrl ?? '')); } catch { return record(false, 'Not refreshed: no usable metadata address.'); }
    if (!hostAllowed(target, await ctx.settings.get<unknown>('integrations.allowed_hosts', []))) {
      return record(false, `Not refreshed: ${target.host} is not on the list of allowed hosts.`);
    }
    if (!c.metadataCert) return record(false, 'Not refreshed: no metadata signing certificate is set.');
    let meta;
    let certs: string[];
    try {
      const xml = await fetchText(target.toString(), 'metadata address');
      meta = parseIdpMetadata(verifyMetadataSignature(xml, c.metadataCert));
      if (meta.validUntil && Date.parse(meta.validUntil) < Date.now()) throw new IdentityError('metadata out of date', `the metadata was valid until ${meta.validUntil.slice(0, 10)}`);
      if (meta.entityId !== c.idpEntityId) throw new IdentityError('entity ID changed', `the metadata names another entity ID (${meta.entityId.slice(0, 100)}); change it by hand if that is right`);
      // Each certificate on its own: one that cannot be used (a weak key) is skipped, not the whole list.
      certs = meta.certificates.flatMap((b64) => readCertificates(b64).certs);
      if (!certs.length) throw new IdentityError('no usable signing certificate', 'the metadata lists no usable signing certificate');
    } catch (err) {
      const why = err instanceof IdentityError ? err.message || err.reason : 'error';
      await ctx.audit(req, { action: 'identity_provider.metadata_refresh', recordType: 'identity_provider', recordId: row.id, summary: `SAML metadata of "${row.name}" not refreshed from ${target.host}: ${why}`.slice(0, 500) });
      return record(false, `Not refreshed: ${why}`);
    }
    const merged = mergeRefreshedCertificates(c.idpCerts ?? [], c.certsDropped ?? {}, certs);
    const next = { ...c, idpCerts: merged.idpCerts, certsDropped: merged.certsDropped, ssoUrl: meta.ssoUrl, ...(meta.sloUrl ? { sloUrl: meta.sloUrl } : {}) };
    const changes = [
      ...merged.added.map((f) => `signing certificate added (${f.slice(0, 23)}…)`),
      ...merged.removed.map((f) => `signing certificate removed (${f.slice(0, 23)}…)`),
      ...(merged.keptForRollover.length ? [`${merged.keptForRollover.length} certificate(s) no longer listed, kept for up to ${ROLLOVER_DAYS} days`] : []),
      ...(meta.ssoUrl !== c.ssoUrl ? ['sign-in address changed'] : []),
      ...(meta.sloUrl && meta.sloUrl !== c.sloUrl ? ['sign-out address changed'] : []),
    ];
    const message = changes.length ? `Refreshed: ${changes.join('; ')}.` : 'Refreshed: no change.';
    const out = await record(true, message, { idpCerts: next.idpCerts, certsDropped: next.certsDropped, ssoUrl: next.ssoUrl, sloUrl: next.sloUrl });
    DRIVERS.saml.forget?.(toRecord(row));
    await ctx.audit(req, {
      action: 'identity_provider.metadata_refresh', recordType: 'identity_provider', recordId: row.id,
      summary: `SAML metadata of "${row.name}" refreshed from ${target.host} (signature checked). ${message}`.slice(0, 500),
      ...(changes.length ? {
        before: { signingCertificates: certificateFacts(c.idpCerts).map((x) => x.fingerprint), ssoUrl: c.ssoUrl, sloUrl: c.sloUrl },
        after: { signingCertificates: certificateFacts(next.idpCerts).map((x) => x.fingerprint), ssoUrl: next.ssoUrl, sloUrl: next.sloUrl },
      } : {}),
    });
    return out;
  }

  adminRoute(ctx, 'POST', '/api/admin/identity-providers/:id/refresh-metadata', async (req) => {
    const row = await getRow(idParam(req, 'Sign-in provider'));
    if (row.type !== 'saml') ctx.fail(409, 'not_saml', 'Only a SAML provider has metadata to refresh.');
    if (!row.config?.metadataUrl || !row.config?.metadataCert) ctx.fail(409, 'not_set_up', 'Set the metadata address and its signing certificate first.');
    if ((await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) !== true) {
      ctx.fail(409, 'outbound_off', 'Outbound connections are switched off (Settings > Integrations), so metadata cannot be fetched.');
    }
    await sensitive(ctx, req, `refreshing the metadata of "${row.name}"`);
    return refreshMetadata(row, req);
  });

  // Every day, for the providers with the refresh on (through the job queue: once however many servers share the database).
  ctx.app.addHook('onReady', async () => {
    await scheduleWork(ctx, 'admin.saml_metadata_refresh', async () => {
      const rows = await db.query<Row>(
        `select * from identity_providers where deleted_at is null and type = 'saml' and coalesce((config->>'metadataRefresh')::boolean, false)`,
      );
      const results = [];
      for (const row of rows) results.push({ provider: row.key, ...(await refreshMetadata(row, null)) });
      return { providers: results.length, refreshed: results.filter((r) => r.ok).length };
    }, { every: 24 * 3_600_000, firstRunInMs: 15 * 60_000 });
  });

  adminRoute(ctx, 'DELETE', '/api/admin/identity-providers/:id', async (req) => {
    const row = await getRow(idParam(req, 'Sign-in provider'));
    if (row.enabled) ctx.fail(409, 'enabled', 'Switch the provider off before removing it.');
    await sensitive(ctx, req, `removing the sign-in provider "${row.name}"`);
    await db.query('update identity_providers set deleted_at = now(), is_default = false, enabled = false, updated_by = $2 where id = $1', [row.id, req.user!.id]);
    await db.query('update identity_user_settings set permit_provider_id = null, permit_expires_at = null where permit_provider_id = $1', [row.id]);
    await ctx.audit(req, {
      action: 'identity_provider.delete', recordType: 'identity_provider', recordId: row.id,
      summary: `Sign-in provider "${row.name}" removed (${row.linked} linked identit${row.linked === 1 ? 'y' : 'ies'} no longer usable)`, before: summaryOf(row),
    });
    return { ok: true };
  });

  // ---------- one person's sign-in ----------

  const userExists = async (id: string) => {
    const u = await db.one<{ id: string; username: string; status: string; email: string; has_password: boolean }>(
      'select id, username, status, email, (password_hash is not null) as has_password from users where id = $1 and deleted_at is null', [id],
    );
    if (!u) ctx.fail(404, 'not_found', 'User not found.');
    return u!;
  };

  const settingsRow = (userId: string) => db.one<Row>('select * from identity_user_settings where user_id = $1', [userId]);
  const ensureSettings = (userId: string, by: string) => db.query(
    'insert into identity_user_settings (user_id, updated_by) values ($1,$2) on conflict (user_id) do nothing', [userId, by],
  );

  adminRoute(ctx, 'GET', '/api/admin/users/:id/sign-in', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const s = await settingsRow(u.id);
    const providers = await db.query<Row>('select id, key, name, enabled from identity_providers where deleted_at is null order by lower(name)');
    const permitProvider = s?.permit_provider_id && s.permit_expires_at && new Date(s.permit_expires_at) > new Date()
      ? providers.find((p) => p.id === s.permit_provider_id) : undefined;
    return {
      identities: await db.query(
        `select i.id, i.email, i.linked_at, i.last_used_at, i.link_method, p.key as provider_key, p.name as provider_name, p.enabled
         from user_identities i join identity_providers p on p.id = i.provider_id and p.deleted_at is null
         where i.user_id = $1 order by p.name`, [u.id]),
      allowedMethods: s?.allowed_methods ?? null,
      breakGlass: Boolean(s?.break_glass),
      permit: permitProvider ? { providerId: permitProvider.id, providerName: permitProvider.name, expiresAt: s!.permit_expires_at } : null,
      providers: providers.map((p) => ({ id: p.id, key: p.key, name: p.name, enabled: p.enabled })),
      localSignIn: (await ctx.settings.get('auth.local_signin', true)) !== false,
      hasPassword: u.has_password,
      breakGlassUser: (await breakGlassUser(ctx)) ?? null,
    };
  });

  adminRoute(ctx, 'PATCH', '/api/admin/users/:id/sign-in', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const b = body(req);
    const s = await settingsRow(u.id);
    let allowed: string[] | null = null;
    if (b.allowedMethods !== null) {
      const keys = new Set((await db.query<{ key: string }>('select key from identity_providers where deleted_at is null')).map((r) => r.key));
      if (!Array.isArray(b.allowedMethods) || !b.allowedMethods.length || b.allowedMethods.some((m: unknown) => typeof m !== 'string' || (m !== 'local' && !keys.has(m)))) {
        invalid({ allowedMethods: 'Choose at least one way to sign in, or allow every way.' });
      }
      allowed = [...new Set(b.allowedMethods as string[])].sort();
    }
    if (s?.break_glass && allowed && !allowed.includes('local')) invalid({ allowedMethods: 'The break-glass account always keeps its password.' });
    await sensitive(ctx, req, `changing how ${u.username} may sign in`);
    await ensureSettings(u.id, req.user!.id);
    await db.query('update identity_user_settings set allowed_methods = $2, updated_at = now(), updated_by = $3 where user_id = $1', [u.id, allowed, req.user!.id]);
    await ctx.audit(req, {
      action: 'user.sign_in_methods', recordType: 'user', recordId: u.id,
      summary: allowed ? `${u.username} may sign in only with: ${allowed.join(', ')}` : `${u.username} may sign in in every available way`,
      before: { allowed_methods: s?.allowed_methods ?? null }, after: { allowed_methods: allowed },
    });
    return { ok: true, allowedMethods: allowed };
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/link-permit', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const providerId = String(body(req).providerId ?? '');
    const p = UUID_RE.test(providerId) ? await providerById(db, providerId) : null;
    if (!p) invalid({ providerId: 'Choose a sign-in provider.' });
    const s = await settingsRow(u.id);
    if (s?.break_glass) ctx.fail(409, 'break_glass', 'The break-glass account cannot be linked to a sign-in provider.');
    if (await db.one('select 1 from user_identities where user_id = $1 and provider_id = $2', [u.id, p!.id])) {
      ctx.fail(409, 'already_linked', `${u.username} is already linked to ${p!.name}.`);
    }
    await sensitive(ctx, req, `allowing ${u.username} to link ${p!.name}`);
    await ensureSettings(u.id, req.user!.id);
    const row = await db.one<{ permit_expires_at: string }>(
      `update identity_user_settings set permit_provider_id = $2, permit_expires_at = now() + make_interval(days => $3::int),
         permit_by = $4, updated_at = now(), updated_by = $4 where user_id = $1 returning permit_expires_at`,
      [u.id, p!.id, PERMIT_DAYS, req.user!.id],
    );
    await ctx.audit(req, {
      action: 'identity.link_permit', recordType: 'user', recordId: u.id,
      summary: `${u.username} may link a ${p!.name} identity with the email ${u.email} at their next sign-in (until ${new Date(row!.permit_expires_at).toISOString()})`,
    });
    return { ok: true, expiresAt: row!.permit_expires_at, providerName: p!.name };
  });

  adminRoute(ctx, 'DELETE', '/api/admin/users/:id/link-permit', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const row = await db.one('update identity_user_settings set permit_provider_id = null, permit_expires_at = null, permit_by = null where user_id = $1 and permit_provider_id is not null returning 1', [u.id]);
    if (row) await ctx.audit(req, { action: 'identity.link_permit_cancel', recordType: 'user', recordId: u.id, summary: `Permission for ${u.username} to link at next sign-in withdrawn` });
    return { ok: true };
  });

  adminRoute(ctx, 'DELETE', '/api/admin/users/:id/identities/:identityId', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const identityId = String((req.params as Record<string, string>).identityId ?? '');
    const row = UUID_RE.test(identityId) ? await db.one<{ id: string; provider_id: string; email: string | null }>(
      'select id, provider_id, email from user_identities where id = $1 and user_id = $2', [identityId, u.id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Linked identity not found.');
    await sensitive(ctx, req, `unlinking a sign-in provider from ${u.username}`);
    await unlinkIdentity(ctx, req, u.id, row!, 'by an administrator');
    return { ok: true };
  });

  adminRoute(ctx, 'POST', '/api/admin/users/:id/break-glass', async (req) => {
    const u = await userExists(idParam(req, 'User'));
    const on = body(req).breakGlass === true;
    const s = await settingsRow(u.id);
    if (on === Boolean(s?.break_glass)) return { ok: true, breakGlass: on };
    if (on) {
      const current = await breakGlassUser(ctx);
      if (current) ctx.fail(409, 'exists', `${current.username} is already the break-glass account. There can be only one: remove that designation first.`);
      if (u.status !== 'active' || !u.has_password) ctx.fail(409, 'not_ready', 'The break-glass account must be active and have a password.');
      const admin = await db.one(
        `select 1 from user_roles ur join roles r on r.id = ur.role_id and r.enabled join role_permissions rp on rp.role_id = r.id
         where ur.user_id = $1 and rp.permission in ('*', 'admin.*', 'admin.administer')`, [u.id]);
      if (!admin) ctx.fail(409, 'not_admin', 'The break-glass account must hold the Administrator role (or another role that administers).');
      if ((await signInMethods(ctx, u.id)).identities.length) ctx.fail(409, 'linked', 'Unlink this account from every sign-in provider first: the break-glass account uses its password only.');
    } else if (!(await ctx.settings.get('auth.local_signin', true))) {
      ctx.fail(409, 'local_off', 'Local passwords are switched off, so the break-glass account is the only way in if single sign-on fails. Switch local passwords on before removing it.');
    }
    await sensitive(ctx, req, `${on ? 'making' : 'removing'} ${u.username} ${on ? 'the' : 'as the'} break-glass account`);
    await ensureSettings(u.id, req.user!.id);
    await db.query(
      `update identity_user_settings set break_glass = $2, allowed_methods = case when $2 then null else allowed_methods end,
         permit_provider_id = case when $2 then null else permit_provider_id end, updated_at = now(), updated_by = $3 where user_id = $1`,
      [u.id, on, req.user!.id],
    );
    await ctx.audit(req, {
      action: on ? 'user.break_glass_on' : 'user.break_glass_off', recordType: 'user', recordId: u.id,
      summary: on ? `${u.username} designated as the break-glass account: password sign-in always, single sign-on never, every sign-in alerts administrators`
        : `${u.username} is no longer the break-glass account`,
      before: { break_glass: !on }, after: { break_glass: on },
    });
    return { ok: true, breakGlass: on };
  });
}

function toRecord(r: Row): ProviderRecord {
  return { id: r.id, key: r.key, type: r.type, name: r.name, enabled: r.enabled, isDefault: r.is_default, config: r.config ?? {}, secretSealed: r.secret };
}

export { IdentityError };
