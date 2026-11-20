// Directory (LDAP) sign-in (E02-26): Active Directory, OpenLDAP and other LDAP v3 directories.
//
// A `credentials` provider: the person types their directory user name and password into this
// application's sign-in form, and the directory checks them. The steps, each on an encrypted
// connection (ldapclient.ts):
//
// 1. Bind as the service account (its password is the provider's stored secret, encrypted with the
//    secret key), and search for exactly one entry with the administrator's filter, the user name
//    escaped into it (RFC 4515, ldapfilter.ts). Without a service account, the person's DN is made
//    from a template with the user name DN-escaped (RFC 4514).
// 2. Bind as that entry with the typed password, on a connection of its own. An empty password is
//    refused before anything is sent (an "unauthenticated bind" would succeed).
// 3. Refuse disabled or locked entries (Active Directory userAccountControl, OpenLDAP
//    pwdAccountLockedTime, nsAccountLock).
// 4. Read the person's groups for role mapping: memberOf, Active Directory nested groups through
//    LDAP_MATCHING_RULE_IN_CHAIN, or a group search.
//
// What follows (finding the account, linking, just-in-time accounts, roles, the second factor,
// sessions, audit, lockout) is the shared sign-in in service.ts and the route in modules/admin/sso.ts.
// A directory password is one factor: the second factor still applies.
import { describeCertificate } from './x509.ts';
import { cleanCommonConfig } from './config.ts';
import { attributeValues, LdapConnection, LdapError, readLdapUrl, RESULT, type LdapEndpoint, type LdapEntry } from './ldapclient.ts';
import { fillDn, fillFilter, FilterError, IN_CHAIN, parseFilter } from './ldapfilter.ts';
import { IdentityError, type ExternalIdentity, type LdapConfig, type ProviderDriver, type ProviderRecord } from './types.ts';

/** Defaults offered for each kind of directory. */
export const LDAP_PRESETS: Record<LdapConfig['directory'], Pick<LdapConfig, 'userFilter' | 'idAttribute' | 'emailAttribute' | 'nameAttribute' | 'groupSource' | 'groupFilter'>> = {
  ad: {
    userFilter: '(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))',
    idAttribute: 'objectGUID', emailAttribute: 'mail', nameAttribute: 'displayName',
    groupSource: 'memberOf', groupFilter: '(&(objectClass=group)(member={dn}))',
  },
  openldap: {
    userFilter: '(&(objectClass=inetOrgPerson)(uid={username}))',
    idAttribute: 'entryUUID', emailAttribute: 'mail', nameAttribute: 'displayName',
    groupSource: 'search', groupFilter: '(&(objectClass=groupOfNames)(member={dn}))',
  },
  other: {
    userFilter: '(uid={username})',
    idAttribute: 'entryUUID', emailAttribute: 'mail', nameAttribute: 'cn',
    groupSource: 'search', groupFilter: '(member={dn})',
  },
};

const ATTRIBUTE_RE = /^(?:[A-Za-z][A-Za-z0-9-]{0,63}|\d+(?:\.\d+)+)$/;
const DN_RE = /^[^\u0000-\u001f]{3,500}=[^\u0000-\u001f]*$/;
const MAX_GROUPS = 1000;

/** Why a directory sign-in failed, for the route: the person always sees the same generic message. */
export class DirectoryRefusal extends IdentityError {
  /** `password`: the password was wrong (counts toward lockout). */
  kind: 'password' | 'disabled' | 'not_found' | 'unavailable' | 'config';
  /** The entry's identifier, when it was found (to find a linked account for lockout). */
  subject: string | null;
  constructor(kind: DirectoryRefusal['kind'], reason: string, subject: string | null = null) {
    super(reason);
    this.kind = kind;
    this.subject = subject;
  }
}

/** Active Directory's bind sub-codes ("data 52e" in the diagnostic message). */
const AD_CODES: Record<string, [DirectoryRefusal['kind'], string]> = {
  '525': ['not_found', 'directory: no such user'],
  '52e': ['password', 'wrong directory password'],
  '530': ['disabled', 'directory: not permitted to sign in at this time'],
  '531': ['disabled', 'directory: not permitted to sign in from this workstation'],
  '532': ['disabled', 'directory: password expired'],
  '533': ['disabled', 'directory account disabled'],
  '701': ['disabled', 'directory account expired'],
  '773': ['disabled', 'directory: the password must be changed first'],
  '775': ['disabled', 'directory account locked'],
};

function bindRefusal(code: number, diagnostic: string, subject: string | null): DirectoryRefusal {
  const ad = /data ([0-9a-f]{3,4})/i.exec(diagnostic)?.[1]?.toLowerCase();
  if (ad && AD_CODES[ad]) return new DirectoryRefusal(AD_CODES[ad][0], AD_CODES[ad][1], subject);
  if (code === RESULT.invalidCredentials) return new DirectoryRefusal('password', 'wrong directory password', subject);
  if (code === RESULT.unwillingToPerform || code === RESULT.insufficientAccessRights) return new DirectoryRefusal('disabled', `directory refused the bind (result ${code})`, subject);
  return new DirectoryRefusal('unavailable', `directory bind failed (result ${code})`, subject);
}

const endpointOf = (c: LdapConfig): LdapEndpoint => ({ url: c.url, startTls: c.startTls, caCert: c.caCert || undefined, timeoutMs: 10_000 });

async function open(c: LdapConfig): Promise<LdapConnection> {
  try {
    return await LdapConnection.open(endpointOf(c));
  } catch (err) {
    throw new DirectoryRefusal('unavailable', err instanceof LdapError ? `directory: ${err.reason}` : 'directory could not be reached');
  }
}

/** A GUID as Active Directory shows it (the first three parts are stored little-endian). */
function guid(b: Buffer): string {
  const h = b.toString('hex');
  const le = (s: string) => s.match(/../g)!.reverse().join('');
  return `${le(h.slice(0, 8))}-${le(h.slice(8, 12))}-${le(h.slice(12, 16))}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Text of an attribute value; binary values as hex. */
const text = (b: Buffer | undefined): string | null => {
  if (!b || !b.length) return null;
  const s = b.toString('utf8');
  return Buffer.from(s, 'utf8').equals(b) && !/[\u0000-\u001f]/.test(s) ? s : `hex:${b.toString('hex')}`;
};

export function subjectOf(entry: LdapEntry, c: LdapConfig): string {
  const raw = attributeValues(entry, c.idAttribute)[0];
  if (!raw || !raw.length) throw new DirectoryRefusal('config', `the directory entry has no ${c.idAttribute.slice(0, 40)} (identifier attribute)`);
  const value = c.idAttribute.toLowerCase() === 'objectguid' && raw.length === 16 ? guid(raw) : text(raw)!;
  if (value.length > 255) throw new DirectoryRefusal('config', 'the identifier attribute is too long');
  return value;
}

/** Why the entry may not sign in, or null. */
export function entryDisabled(entry: LdapEntry): string | null {
  const uac = Number(text(attributeValues(entry, 'userAccountControl')[0]) ?? '0');
  if (Number.isFinite(uac) && (uac & 0x2)) return 'directory account disabled';
  if (attributeValues(entry, 'pwdAccountLockedTime').length) return 'directory account locked';
  if ((text(attributeValues(entry, 'nsAccountLock')[0]) ?? '').toLowerCase() === 'true') return 'directory account locked';
  return null;
}

const wanted = (c: LdapConfig) => [...new Set([
  c.idAttribute, c.emailAttribute, c.nameAttribute, 'givenName', 'sn', 'cn',
  'userAccountControl', 'pwdAccountLockedTime', 'nsAccountLock',
  ...(c.groupSource === 'memberOf' ? ['memberOf'] : []),
].filter(Boolean))];

/** The person's groups (DNs), for role mapping. */
async function groupsOf(conn: LdapConnection, entry: LdapEntry, c: LdapConfig, username: string): Promise<string[]> {
  const groups = new Set<string>();
  const base = c.groupBaseDn || c.baseDn;
  if (c.groupSource === 'memberOf') {
    for (const v of attributeValues(entry, 'memberOf')) { const g = text(v); if (g) groups.add(g); }
  } else {
    const found = await conn.search(base, 2, parseFilter(fillFilter(c.groupFilter, { dn: entry.dn, username })), ['1.1'], MAX_GROUPS);
    for (const g of found) groups.add(g.dn);
  }
  if (c.nestedGroups) {
    // Active Directory evaluates group nesting itself with this matching rule.
    const found = await conn.search(base, 2, parseFilter(fillFilter(`(member:${IN_CHAIN}:={dn})`, { dn: entry.dn })), ['1.1'], MAX_GROUPS);
    for (const g of found) groups.add(g.dn);
  }
  return [...groups].filter((g) => g.length <= 256).slice(0, 500);
}

function identityOf(entry: LdapEntry, c: LdapConfig, subject: string, groups: string[]): ExternalIdentity {
  const mail = text(attributeValues(entry, c.emailAttribute)[0]);
  const email = mail && /^[^@\s]+@[^@\s]+$/.test(mail) && mail.length <= 254 ? mail.toLowerCase() : null;
  const given = [text(attributeValues(entry, 'givenName')[0]), text(attributeValues(entry, 'sn')[0])].filter(Boolean).join(' ');
  return {
    subject,
    email,
    // A directory has no "email verified" statement: addresses count as verified only when the administrator trusts them.
    emailVerified: Boolean(email) && c.trustEmail === true,
    displayName: (text(attributeValues(entry, c.nameAttribute)[0]) ?? (given || text(attributeValues(entry, 'cn')[0]))) || null,
    groups,
    amr: ['pwd'],
    acr: null,
  };
}

/** Finds the person's entry with the service account (or the DN template). Leaves `conn` bound as the service account (or the person). */
async function findEntry(conn: LdapConnection, c: LdapConfig, secret: string | null, username: string, password: string | null): Promise<LdapEntry> {
  const filter = parseFilter(fillFilter(c.userFilter, { username }));
  if (c.bindDn) {
    if (!secret) throw new DirectoryRefusal('config', 'the service account password cannot be read (the secret key changed?)');
    const b = await conn.bind(c.bindDn, secret);
    if (b.code !== RESULT.success) throw new DirectoryRefusal('config', `the directory refused the service account (result ${b.code})`);
    const found = await conn.search(c.baseDn, 2, filter, wanted(c), 2).catch((err) => {
      if (err instanceof LdapError && err.code === RESULT.sizeLimitExceeded) return [null, null];
      throw err;
    });
    if (found.length === 0) throw new DirectoryRefusal('not_found', 'no such user in the directory');
    if (found.length > 1) throw new DirectoryRefusal('not_found', 'the user name matches more than one directory entry');
    return found[0]!;
  }
  // No service account: bind as the person (DN made from the template), then read their own entry.
  const dn = fillDn(c.userDnTemplate, { username });
  if (password === null) throw new DirectoryRefusal('config', 'without a service account a user can be looked up only with their password');
  const b = await conn.bind(dn, password);
  if (b.code !== RESULT.success) throw bindRefusal(b.code, b.diagnostic, null);
  const found = await conn.search(dn, 0, filter, wanted(c), 1).catch(() => []);
  if (found.length !== 1) throw new DirectoryRefusal('not_found', 'the directory entry does not match the user filter');
  return found[0];
}

const usable = (username: string) => username.length >= 1 && username.length <= 256 && !/[\u0000-\u001f\u007f]/.test(username);

export async function ldapAuthenticate(provider: ProviderRecord, secret: string | null, username: string, password: string): Promise<ExternalIdentity> {
  const c = provider.config as LdapConfig;
  const name = String(username ?? '').trim();
  if (!usable(name)) throw new DirectoryRefusal('not_found', 'user name not usable');
  if (!password) throw new DirectoryRefusal('password', 'empty password (never sent: it would be an unauthenticated bind)');
  if (password.length > 1024) throw new DirectoryRefusal('password', 'password too long');
  const conn = await open(c);
  try {
    const entry = await findEntry(conn, c, secret, name, password);
    const subject = subjectOf(entry, c);
    if (c.bindDn) {
      // The password, checked by binding as the entry on a connection of its own.
      const own = await open(c);
      try {
        const b = await own.bind(entry.dn, password);
        if (b.code !== RESULT.success) throw bindRefusal(b.code, b.diagnostic, subject);
      } finally {
        own.close();
      }
    }
    const disabled = entryDisabled(entry);
    if (disabled) throw new DirectoryRefusal('disabled', disabled, subject);
    const groups = c.mappingEnabled ? await groupsOf(conn, entry, c, name) : [];
    return identityOf(entry, c, subject, groups);
  } catch (err) {
    if (err instanceof DirectoryRefusal) throw err;
    if (err instanceof FilterError) throw new DirectoryRefusal('config', `the filter cannot be used: ${err.message}`);
    if (err instanceof LdapError) throw new DirectoryRefusal('unavailable', `directory: ${err.reason}`);
    throw err;
  } finally {
    conn.close();
  }
}

/** Checks one filter template: it parses, and names the placeholders it needs. */
function filterProblem(template: string, needs: string[], allowed: string[]): string | null {
  if (!template) return 'Enter a filter.';
  if (template.length > 1000) return 'The filter is too long.';
  for (const n of needs) if (!template.includes(`{${n}}`)) return `The filter must contain {${n}}.`;
  const placeholders = Object.fromEntries(allowed.map((a) => [a, 'x']));
  try { parseFilter(fillFilter(template, placeholders)); } catch (err) { return `The filter is not valid LDAP filter syntax (${(err as Error).message}).`; }
  return null;
}

export const ldapDriver: ProviderDriver = {
  type: 'ldap',
  label: 'Directory (LDAP)',
  style: 'credentials',

  cleanConfig(input, existing) {
    const { config: common, fields } = cleanCommonConfig(input, existing);
    const textOf = (k: string, fallback = '') => String(input[k] ?? existing?.[k] ?? fallback).trim();
    const onOff = (k: string, fallback = false) => {
      const v = input[k] !== undefined ? input[k] : existing?.[k] ?? fallback;
      if (typeof v !== 'boolean') fields[k] = 'Choose on or off.';
      return v === true;
    };
    const directory = textOf('directory', 'ad') as LdapConfig['directory'];
    if (!(directory in LDAP_PRESETS)) fields.directory = 'Choose the kind of directory.';
    const preset = LDAP_PRESETS[directory] ?? LDAP_PRESETS.other;
    const startTls = onOff('startTls');
    const url = textOf('url');
    if (!url) fields.url = 'Enter the directory address, for example ldaps://dc1.example.org.';
    else {
      const { problem } = readLdapUrl(url, startTls);
      if (problem || url.length > 300) fields.url = `The address ${problem ?? 'is too long'}.`;
      else if (url.startsWith('ldaps:') && startTls) fields.startTls = 'StartTLS is for an ldap:// address; ldaps:// is encrypted from the start.';
    }
    const rawCa = textOf('caCert');
    let caCert = '';
    if (rawCa) {
      if (/PRIVATE KEY/.test(rawCa)) fields.caCert = 'Give a certificate only, never a private key.';
      else {
        // Any key type: this is a TLS trust anchor, not a SAML signing key.
        const pems = [...rawCa.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map((m) => m[0]);
        const unreadable = pems.some((p) => { try { describeCertificate(p); return false; } catch { return true; } });
        if (!pems.length) fields.caCert = 'Paste the CA certificate in PEM form (-----BEGIN CERTIFICATE-----).';
        else if (pems.length > 5) fields.caCert = 'Give at most 5 certificates.';
        else if (unreadable) fields.caCert = 'A certificate is not readable: paste it as given, in PEM form.';
        else caCert = pems.join('\n');
      }
    }
    const dnField = (k: string, label: string, required: boolean) => {
      const v = textOf(k);
      if (!v) { if (required) fields[k] = `Enter the ${label}.`; return ''; }
      if (v.length > 500 || !DN_RE.test(v)) fields[k] = `The ${label} must be a distinguished name, such as dc=example,dc=org.`;
      return v;
    };
    const bindDn = dnField('bindDn', 'service account DN', false);
    const baseDn = dnField('baseDn', 'base DN', true);
    const userDnTemplate = textOf('userDnTemplate');
    if (!bindDn) {
      if (!userDnTemplate) fields.bindDn = 'Enter the service account DN, or a user DN template for directories that allow people to read their own entry.';
      else if (!userDnTemplate.includes('{username}') || userDnTemplate.length > 500 || !DN_RE.test(userDnTemplate.replace('{username}', 'x'))) {
        fields.userDnTemplate = 'The template must be a DN containing {username}, such as uid={username},ou=people,dc=example,dc=org.';
      }
    }
    const userFilter = textOf('userFilter', preset.userFilter);
    // With a service account the filter finds the person; without one it only checks the entry read at its own DN.
    const userProblem = filterProblem(userFilter, bindDn ? ['username'] : [], ['username']);
    if (userProblem) fields.userFilter = userProblem;
    const attribute = (k: string, fallback: string, required: boolean) => {
      const v = textOf(k, fallback);
      if (!v) { if (required) fields[k] = 'Enter an attribute name.'; return ''; }
      if (!ATTRIBUTE_RE.test(v)) fields[k] = 'Use an attribute name such as mail or objectGUID.';
      return v;
    };
    const groupSource = textOf('groupSource', preset.groupSource) as LdapConfig['groupSource'];
    if (groupSource !== 'memberOf' && groupSource !== 'search') fields.groupSource = 'Choose where groups come from.';
    const groupFilter = textOf('groupFilter', preset.groupFilter);
    if (groupSource === 'search') {
      const p = filterProblem(groupFilter, ['dn'], ['dn', 'username']);
      if (p) fields.groupFilter = p;
    }
    const config: LdapConfig = {
      ...common,
      // A directory password is one factor; the provider never stands in for the second factor here.
      providerMfa: false, mfaAmr: [], mfaAcr: [],
      directory: directory in LDAP_PRESETS ? directory : 'other',
      url, startTls, caCert, bindDn, userDnTemplate: bindDn ? '' : userDnTemplate, baseDn, userFilter,
      idAttribute: attribute('idAttribute', preset.idAttribute, true),
      emailAttribute: attribute('emailAttribute', preset.emailAttribute, false),
      nameAttribute: attribute('nameAttribute', preset.nameAttribute, false),
      groupSource, groupBaseDn: dnField('groupBaseDn', 'group base DN', false), groupFilter,
      nestedGroups: onOff('nestedGroups'),
    };
    return { config, fields };
  },

  async test(provider, secret, opts = {}) {
    const c = provider.config as LdapConfig;
    let conn: LdapConnection;
    try {
      conn = await LdapConnection.open(endpointOf(c));
    } catch (err) {
      return { ok: false, message: `Could not open an encrypted connection to the directory: ${err instanceof LdapError ? err.reason : 'error'}.` };
    }
    const details: Record<string, unknown> = {};
    try {
      const tls = conn.tlsInfo();
      if (tls) Object.assign(details, { tls: tls.protocol, certificate: tls.subject, certificateIssuer: tls.issuer, certificateExpires: tls.validTo });
      else details.tls = 'none (plain LDAP to this machine, for tests only)';
      if (!c.bindDn) {
        return { ok: true, message: 'The encrypted connection works. Without a service account nothing more can be checked until someone signs in.', details };
      }
      if (!secret) return { ok: false, message: 'The service account password cannot be read (the secret key changed?). Enter it again.', details };
      const b = await conn.bind(c.bindDn, secret);
      if (b.code !== RESULT.success) return { ok: false, message: `The encrypted connection works, but the directory refused the service account (result ${b.code}). Check its DN and password.`, details };
      details.serviceAccount = 'accepted';
      const base = await conn.search(c.baseDn, 0, parseFilter('(objectClass=*)'), ['1.1'], 1).catch(() => []);
      details.baseDn = base.length ? 'found' : 'NOT FOUND (or the service account may not read it)';
      const username = String(opts.username ?? '').trim();
      if (!username) {
        return { ok: base.length > 0, message: base.length ? 'The connection, the service account and the base DN all work. Give a user name to look a person up too.' : 'The service account works, but the base DN was not found.', details };
      }
      if (!usable(username)) return { ok: false, message: 'That user name cannot be used.', details };
      const entry = await findEntry(conn, c, secret, username, null);
      const groups = await groupsOf(conn, entry, c, username).catch((err) => [`(groups could not be read: ${err instanceof LdapError ? err.reason : 'error'})`]);
      const subject = (() => { try { return subjectOf(entry, c); } catch (err) { return `MISSING: ${(err as Error).message}`; } })();
      const who = identityOf(entry, c, subject, []);
      Object.assign(details, {
        dn: entry.dn, identifier: subject, email: who.email ?? 'none', displayName: who.displayName ?? 'none',
        disabled: entryDisabled(entry) ?? 'no', groups,
      });
      return { ok: !subject.startsWith('MISSING'), message: `Found ${username} in the directory. Nothing was signed in; the password was not checked.`, details };
    } catch (err) {
      const reason = err instanceof IdentityError ? err.reason : err instanceof LdapError ? err.reason : err instanceof FilterError ? err.message : 'error';
      return { ok: false, message: `The directory check failed: ${reason}.`, details };
    } finally {
      conn.close();
    }
  },

  authenticate: ldapAuthenticate,
};

