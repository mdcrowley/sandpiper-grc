// Directory (LDAP) sign-in (E02-26), the parts that need no application: filter and DN escaping,
// the filter codec, the client against a stand-in directory on this machine (TLS, StartTLS, refusals)
// and the driver (search, password, disabled accounts, groups, injection). The sign-in route is
// tested in server/src/modules/admin/ldap.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readElement } from './ber.ts';
import { DirectoryRefusal, ldapDriver } from './ldap.ts';
import { LdapConnection, readLdapUrl } from './ldapclient.ts';
import { startFakeLdap, type FakeLdap, type FakeLdapEntry } from './ldap-fake-server.ts';
import { decodeFilter, encodeFilter, escapeDnValue, escapeFilterValue, fillDn, fillFilter, filterToString, parseFilter } from './ldapfilter.ts';
import type { ProviderRecord } from './types.ts';

const BASE = 'dc=example,dc=org';
const SERVICE = { dn: `cn=grc-service,ou=services,${BASE}`, password: 'service-pass-31337' };
const guid = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

function directory(): FakeLdapEntry[] {
  return [
    { dn: BASE, attributes: { objectClass: ['domain'] } },
    { dn: SERVICE.dn, password: SERVICE.password, attributes: { objectClass: ['person'], cn: ['grc-service'] } },
    {
      dn: `cn=Dana Driver,ou=people,${BASE}`, password: 'route-14-depot',
      attributes: {
        objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['dana'], uid: ['dana'], mail: ['Dana.Driver@example.org'], displayName: ['Dana Driver'],
        objectGUID: [guid], entryUUID: ['5d8f1c2a-0000-4000-8000-000000000001'], userAccountControl: ['512'],
        memberOf: [`cn=Dispatch,ou=groups,${BASE}`],
      },
    },
    {
      dn: `cn=Off Duty,ou=people,${BASE}`, password: 'off-duty-pass',
      attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['offduty'], uid: ['offduty'], entryUUID: ['5d8f1c2a-0000-4000-8000-000000000002'], objectGUID: [Buffer.alloc(16, 7)], userAccountControl: ['514'] },
    },
    {
      dn: `cn=Locked Out,ou=people,${BASE}`, password: 'locked-pass', locked: true,
      attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['locked'], uid: ['locked'], entryUUID: ['5d8f1c2a-0000-4000-8000-000000000003'], objectGUID: [Buffer.alloc(16, 8)] },
    },
    { dn: `cn=Twin,ou=people,${BASE}`, attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['twin'], uid: ['twin'] } },
    { dn: `cn=Twin,ou=contractors,${BASE}`, attributes: { objectClass: ['person', 'user'], objectCategory: ['person'], sAMAccountName: ['twin'], uid: ['twin'] } },
    { dn: `cn=Dispatch,ou=groups,${BASE}`, attributes: { objectClass: ['group', 'groupOfNames'], member: [`cn=Dana Driver,ou=people,${BASE}`] } },
    { dn: `cn=Operations,ou=groups,${BASE}`, attributes: { objectClass: ['group', 'groupOfNames'], member: [`cn=Dispatch,ou=groups,${BASE}`] } },
  ];
}

const provider = (ldap: FakeLdap, config: Record<string, unknown> = {}): ProviderRecord => {
  const { config: cleaned, fields } = ldapDriver.cleanConfig({
    directory: 'ad', url: ldap.url, startTls: ldap.url.startsWith('ldap://localhost'), caCert: ldap.cert,
    bindDn: SERVICE.dn, baseDn: BASE, groupSource: 'memberOf', ...config,
  }, null);
  expect(fields).toEqual({});
  return { id: 'p1', key: 'directory', type: 'ldap', name: 'Example directory', enabled: true, isDefault: false, config: cleaned, secretSealed: null };
};

describe('filters and distinguished names (RFC 4515, RFC 4514)', () => {
  it('escapes the special characters of a filter value, and every byte that is not printable ASCII', () => {
    expect(escapeFilterValue('Parens R Us (for all your parenthetical needs)')).toBe('Parens R Us \\28for all your parenthetical needs\\29');
    expect(escapeFilterValue('*')).toBe('\\2a');
    expect(escapeFilterValue('C:\\MyFile')).toBe('C:\\5cMyFile');
    expect(escapeFilterValue('\u0000')).toBe('\\00');
    expect(escapeFilterValue('Lučić')).toBe('Lu\\c4\\8di\\c4\\87');
  });

  it('keeps an injection attempt as one literal value', () => {
    for (const attack of ['*', 'dana)(uid=*', '*)(|(objectClass=*', 'dana)(&)', 'x\\2a', 'admin)(!(userAccountControl=514']) {
      const f = parseFilter(fillFilter('(&(objectClass=user)(sAMAccountName={username}))', { username: attack }));
      expect(f.op).toBe('and');
      if (f.op !== 'and') continue;
      expect(f.list).toHaveLength(2);
      expect(f.list[1]).toEqual({ op: 'eq', attr: 'sAMAccountName', value: Buffer.from(attack, 'utf8') });
    }
  });

  it('escapes a value for a distinguished name', () => {
    expect(escapeDnValue('Sue, Grabbit and Runn')).toBe('Sue\\, Grabbit and Runn');
    expect(escapeDnValue(' #lead')).toBe('\\ #lead');
    expect(escapeDnValue('#lead')).toBe('\\#lead');
    expect(escapeDnValue('trail ')).toBe('trail\\ ');
    expect(escapeDnValue('a+b=c;d<e>f"g\\h')).toBe('a\\+b\\=c\\;d\\<e\\>f\\"g\\\\h');
    expect(fillDn('uid={username},ou=people,dc=example,dc=org', { username: 'x,ou=admins' })).toBe('uid=x\\,ou\\=admins,ou=people,dc=example,dc=org');
  });

  it('parses every kind of filter, and the binary form reads back the same', () => {
    const text = '(&(objectClass=person)(|(cn=Dana*)(sn=*river*end)(!(mail=*)))(uidNumber>=1000)(uidNumber<=2000)(cn~=dana)(member:1.2.840.113556.1.4.1941:=cn=Ops\\2cdc=example)(:dn:2.5.13.5:=x))';
    const f = parseFilter(text);
    const back = decodeFilter(readElement(encodeFilter(f))!.el);
    expect(back).toEqual(f);
    expect(filterToString(back)).toBe(text.replace('\\2c', ','));
  });

  it('refuses malformed filters and unknown placeholders', () => {
    for (const bad of ['', 'uid=x', '(uid=x', '(uid=x))', '(&)', '(uid=a(b)', '(uid=\\zz)', '(=x)', '(uid x)', `(${'&('.repeat(30)}uid=x${'))'.repeat(30)})`]) {
      expect(() => parseFilter(bad), bad).toThrow();
    }
    expect(() => fillFilter('(uid={user})', { username: 'x' })).toThrow(/placeholder/);
  });
});

describe('addresses', () => {
  it('accepts ldaps:// and ldap:// with StartTLS, and plain LDAP only to 127.0.0.1', () => {
    expect(readLdapUrl('ldaps://dc1.example.org', false)).toMatchObject({ host: 'dc1.example.org', port: 636, secure: true, problem: null });
    expect(readLdapUrl('ldap://dc1.example.org', true)).toMatchObject({ port: 389, secure: false, problem: null });
    expect(readLdapUrl('ldap://dc1.example.org', false).problem).toMatch(/plain LDAP/);
    expect(readLdapUrl('ldap://127.0.0.1:3890', false).problem).toBeNull();
    expect(readLdapUrl('ldap://localhost:3890', false).problem).toMatch(/plain LDAP/);
    expect(readLdapUrl('https://dc1.example.org', false).problem).toMatch(/ldaps/);
    expect(readLdapUrl('ldaps://user:pw@dc1.example.org', false).problem).toMatch(/user name/);
    expect(readLdapUrl('ldaps://dc1.example.org/dc=example,dc=org', false).problem).toMatch(/base DN/);
  });
});

describe('the client and the stand-in directory', () => {
  let ldaps: FakeLdap;
  let starttls: FakeLdap;
  let refusing: FakeLdap;
  let plain: FakeLdap;
  beforeAll(async () => {
    [ldaps, starttls, refusing, plain] = await Promise.all([
      startFakeLdap({ mode: 'ldaps', entries: directory() }),
      startFakeLdap({ mode: 'starttls', entries: directory() }),
      startFakeLdap({ mode: 'starttls', refuseStartTls: true, entries: directory() }),
      startFakeLdap({ mode: 'none', entries: directory() }),
    ]);
  });
  afterAll(async () => { await Promise.all([ldaps, starttls, refusing, plain].map((s) => s?.close())); });

  it('binds and searches over ldaps:// with a pinned certificate, and over StartTLS', async () => {
    for (const [srv, startTls] of [[ldaps, false], [starttls, true]] as const) {
      const c = await LdapConnection.open({ url: srv.url, startTls, caCert: srv.cert });
      expect(c.tlsInfo()?.protocol).toMatch(/TLSv1\.[23]/);
      expect((await c.bind(SERVICE.dn, SERVICE.password)).code).toBe(0);
      expect((await c.bind(SERVICE.dn, 'wrong')).code).toBe(49);
      const found = await c.search(BASE, 2, parseFilter('(uid=dana)'), ['mail'], 2);
      expect(found.map((e) => e.dn)).toEqual([`cn=Dana Driver,ou=people,${BASE}`]);
      c.close();
    }
    expect(starttls.log[0].op).toBe('starttls'); // nothing is sent before the upgrade
  });

  it('refuses a directory whose certificate is not trusted, one that refuses StartTLS, and an empty password', async () => {
    await expect(LdapConnection.open({ url: ldaps.url, startTls: false })).rejects.toMatchObject({ reason: expect.stringMatching(/not trusted/) });
    await expect(LdapConnection.open({ url: ldaps.url, startTls: false, caCert: plain.cert })).rejects.toMatchObject({ reason: expect.stringMatching(/not trusted/) });
    await expect(LdapConnection.open({ url: refusing.url, startTls: true, caCert: refusing.cert })).rejects.toMatchObject({ reason: 'the directory refused StartTLS' });
    const c = await LdapConnection.open({ url: plain.url, startTls: false });
    const before = plain.log.length;
    await expect(c.bind(SERVICE.dn, '')).rejects.toMatchObject({ reason: expect.stringMatching(/empty password/) });
    expect(plain.log.length).toBe(before); // never sent
    c.close();
  });

  it('signs a person in: service account search, then their own bind; groups from memberOf and nested groups', async () => {
    const p = provider(ldaps, { mappingEnabled: true, mappings: [{ value: `cn=Operations,ou=groups,${BASE}`, role: 'agent' }], nestedGroups: true, trustEmail: true });
    const identity = await ldapDriver.authenticate!(p, SERVICE.password, 'dana', 'route-14-depot');
    expect(identity).toMatchObject({
      subject: '33221100-5544-7766-8899-aabbccddeeff', email: 'dana.driver@example.org', emailVerified: true, displayName: 'Dana Driver',
    });
    expect(identity.groups.sort()).toEqual([`cn=Dispatch,ou=groups,${BASE}`, `cn=Operations,ou=groups,${BASE}`]);
    const binds = ldaps.log.filter((r) => r.op === 'bind');
    expect(binds.slice(-2).map((b) => b.dn)).toEqual([SERVICE.dn, `cn=Dana Driver,ou=people,${BASE}`]);
  });

  it('reads groups with a group search on OpenLDAP', async () => {
    const p = provider(starttls, { directory: 'openldap', idAttribute: 'entryUUID', userFilter: '(uid={username})', groupSource: 'search', mappingEnabled: true, mappings: [{ value: 'x', role: 'agent' }] });
    const identity = await ldapDriver.authenticate!(p, SERVICE.password, 'dana', 'route-14-depot');
    expect(identity.subject).toBe('5d8f1c2a-0000-4000-8000-000000000001');
    expect(identity.groups).toEqual([`cn=Dispatch,ou=groups,${BASE}`]);
    expect(starttls.log.filter((r) => r.op === 'search').pop()?.filter).toBe(`(&(objectClass=groupOfNames)(member=cn=Dana Driver,ou=people,${BASE}))`);
  });

  it('refuses a wrong password, a disabled or locked account, an unknown or ambiguous name, and injection', async () => {
    const p = provider(ldaps);
    const refusal = async (user: string, password: string) => {
      try { await ldapDriver.authenticate!(p, SERVICE.password, user, password); } catch (err) { return err as DirectoryRefusal; }
      throw new Error('signed in');
    };
    expect(await refusal('dana', 'wrong')).toMatchObject({ kind: 'password', reason: 'wrong directory password', subject: '33221100-5544-7766-8899-aabbccddeeff' });
    expect(await refusal('dana', '')).toMatchObject({ kind: 'password' });
    expect(await refusal('offduty', 'off-duty-pass')).toMatchObject({ kind: 'disabled', reason: 'directory account disabled' });
    expect(await refusal('locked', 'locked-pass')).toMatchObject({ kind: 'disabled', reason: 'directory account locked' });
    expect(await refusal('nobody', 'x')).toMatchObject({ kind: 'not_found' });
    expect(await refusal('twin', 'x')).toMatchObject({ kind: 'not_found', reason: expect.stringMatching(/more than one/) });
    for (const attack of ['*', 'dana)(sAMAccountName=*', '*)(|(objectClass=*', 'd*']) {
      expect(await refusal(attack, 'route-14-depot')).toMatchObject({ kind: 'not_found' });
    }
    const filters = ldaps.log.filter((r) => r.op === 'search').map((r) => r.filter);
    expect(filters).toContain('(&(objectCategory=person)(objectClass=user)(sAMAccountName=\\2a))');
    expect(filters).toContain('(&(objectCategory=person)(objectClass=user)(sAMAccountName=dana\\29\\28sAMAccountName=\\2a))');
    expect(filters.some((f) => f?.includes('sAMAccountName=*') || f?.includes('sAMAccountName=d*'))).toBe(false);
  });

  it('without a service account, binds with the DN template (escaped) and reads the entry', async () => {
    const p = provider(plain, { bindDn: '', userDnTemplate: `cn={username},ou=people,${BASE}`, startTls: false, caCert: '', idAttribute: 'entryUUID', userFilter: '(objectClass=person)' });
    const identity = await ldapDriver.authenticate!(p, null, 'Dana Driver', 'route-14-depot');
    expect(identity.subject).toBe('5d8f1c2a-0000-4000-8000-000000000001');
    await expect(ldapDriver.authenticate!(p, null, 'x,ou=people', 'route-14-depot')).rejects.toBeInstanceOf(DirectoryRefusal);
    expect(plain.log.filter((r) => r.op === 'bind').pop()?.dn).toBe(`cn=x\\,ou\\=people,ou=people,${BASE}`);
  });

  it('says plainly when the directory cannot be reached or refuses the service account', async () => {
    const p = provider(ldaps);
    await expect(ldapDriver.authenticate!({ ...p, config: { ...p.config, caCert: '' } }, SERVICE.password, 'dana', 'route-14-depot'))
      .rejects.toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/not trusted/) });
    await expect(ldapDriver.authenticate!(p, 'wrong-service-pass', 'dana', 'route-14-depot')).rejects.toMatchObject({ kind: 'config' });
    await expect(ldapDriver.authenticate!(p, null, 'dana', 'route-14-depot')).rejects.toMatchObject({ kind: 'config' });
  });

  it('tests the connection and looks a person up without checking a password', async () => {
    const p = provider(ldaps, { groupSource: 'memberOf' });
    const plainTest = await ldapDriver.test(p, SERVICE.password);
    expect(plainTest).toMatchObject({ ok: true });
    expect(plainTest.details).toMatchObject({ serviceAccount: 'accepted', baseDn: 'found' });
    const lookup = await ldapDriver.test(p, SERVICE.password, { username: 'dana' });
    expect(lookup.ok).toBe(true);
    expect(lookup.details).toMatchObject({ dn: `cn=Dana Driver,ou=people,${BASE}`, identifier: '33221100-5544-7766-8899-aabbccddeeff', groups: [`cn=Dispatch,ou=groups,${BASE}`] });
    expect((await ldapDriver.test(p, 'nope')).ok).toBe(false);
  });
});

describe('settings', () => {
  const clean = (input: Record<string, unknown>) => ldapDriver.cleanConfig({ directory: 'ad', url: 'ldaps://dc1.example.org', bindDn: SERVICE.dn, baseDn: BASE, ...input }, null);

  it('fills the defaults of the kind of directory', () => {
    const { config, fields } = clean({});
    expect(fields).toEqual({});
    expect(config).toMatchObject({ userFilter: '(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))', idAttribute: 'objectGUID', groupSource: 'memberOf', providerMfa: false });
  });

  it('refuses plain LDAP, a filter without {username}, a broken filter, a private key and a missing base DN', () => {
    expect(clean({ url: 'ldap://dc1.example.org' }).fields.url).toMatch(/plain LDAP/);
    expect(clean({ url: 'ldaps://dc1.example.org', startTls: true }).fields.startTls).toBeTruthy();
    expect(clean({ userFilter: '(uid=dana)' }).fields.userFilter).toMatch(/\{username\}/);
    expect(clean({ userFilter: '(uid={username}' }).fields.userFilter).toMatch(/not valid/);
    expect(clean({ caCert: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }).fields.caCert).toMatch(/private key/);
    expect(clean({ baseDn: '' }).fields.baseDn).toBeTruthy();
    expect(clean({ bindDn: '' }).fields.bindDn).toBeTruthy();
    expect(clean({ groupSource: 'search', groupFilter: '(member=x)' }).fields.groupFilter).toMatch(/\{dn\}/);
    expect(clean({ providerMfa: true, mfaAmr: ['mfa'] }).config.providerMfa).toBe(false); // a directory password is one factor
  });
});
