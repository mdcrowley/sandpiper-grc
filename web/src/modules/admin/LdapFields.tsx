// The directory (LDAP) parts of the sign-in provider editor (E02-26): the kind of directory and its
// defaults, the encrypted connection and the certificate it is trusted by, the service account, how
// a person is found, and where their groups come from. Used by ProviderEditor.tsx.
import { Checkbox, Select, TextArea, TextField } from '../../core';
import type { Provider } from './Providers';

export interface LdapState {
  directory: 'ad' | 'openldap' | 'other';
  url: string; startTls: boolean; caCert: string;
  bindDn: string; userDnTemplate: string; baseDn: string; userFilter: string;
  idAttribute: string; emailAttribute: string; nameAttribute: string;
  groupSource: 'memberOf' | 'search'; groupBaseDn: string; groupFilter: string; nestedGroups: boolean;
}

/** The same defaults the server offers (core/identity/ldap.ts). */
const PRESETS: Record<LdapState['directory'], Pick<LdapState, 'userFilter' | 'idAttribute' | 'emailAttribute' | 'nameAttribute' | 'groupSource' | 'groupFilter'>> = {
  ad: {
    userFilter: '(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))',
    idAttribute: 'objectGUID', emailAttribute: 'mail', nameAttribute: 'displayName', groupSource: 'memberOf', groupFilter: '(&(objectClass=group)(member={dn}))',
  },
  openldap: {
    userFilter: '(&(objectClass=inetOrgPerson)(uid={username}))',
    idAttribute: 'entryUUID', emailAttribute: 'mail', nameAttribute: 'displayName', groupSource: 'search', groupFilter: '(&(objectClass=groupOfNames)(member={dn}))',
  },
  other: {
    userFilter: '(uid={username})', idAttribute: 'entryUUID', emailAttribute: 'mail', nameAttribute: 'cn', groupSource: 'search', groupFilter: '(member={dn})',
  },
};

const DIRECTORIES = [
  { value: 'ad', label: 'Active Directory' },
  { value: 'openldap', label: 'OpenLDAP' },
  { value: 'other', label: 'Another LDAP v3 directory' },
];
const GROUP_SOURCES = [
  { value: 'memberOf', label: 'The person\'s memberOf attribute' },
  { value: 'search', label: 'A search for groups that list the person' },
];

export function ldapInitial(provider: Provider | null): LdapState {
  const c = provider?.type === 'ldap' ? provider.config : null;
  const directory = (c?.directory ?? 'ad') as LdapState['directory'];
  const preset = PRESETS[directory];
  return {
    directory, url: c?.url ?? 'ldaps://', startTls: c?.startTls ?? false, caCert: c?.caCert ?? '',
    bindDn: c?.bindDn ?? '', userDnTemplate: c?.userDnTemplate ?? '', baseDn: c?.baseDn ?? '', userFilter: c?.userFilter ?? preset.userFilter,
    idAttribute: c?.idAttribute ?? preset.idAttribute, emailAttribute: c?.emailAttribute ?? preset.emailAttribute, nameAttribute: c?.nameAttribute ?? preset.nameAttribute,
    groupSource: c?.groupSource ?? preset.groupSource, groupBaseDn: c?.groupBaseDn ?? '', groupFilter: c?.groupFilter ?? preset.groupFilter, nestedGroups: c?.nestedGroups ?? false,
  };
}

/** What the server is sent. */
export function ldapConfig(s: LdapState) {
  return {
    directory: s.directory, url: s.url.trim(), startTls: s.startTls, caCert: s.caCert.trim(), bindDn: s.bindDn.trim(),
    userDnTemplate: s.userDnTemplate.trim(), baseDn: s.baseDn.trim(), userFilter: s.userFilter.trim(), idAttribute: s.idAttribute.trim(),
    emailAttribute: s.emailAttribute.trim(), nameAttribute: s.nameAttribute.trim(), groupSource: s.groupSource, groupBaseDn: s.groupBaseDn.trim(),
    groupFilter: s.groupFilter.trim(), nestedGroups: s.nestedGroups,
  };
}

/** Checks made before saving (the server checks everything again). */
export function ldapProblems(s: LdapState, hasSecret: boolean, secret: string, enabled: boolean): Record<string, string> {
  const found: Record<string, string> = {};
  if (!/^ldaps?:\/\/[^/\s]+\/?$/.test(s.url.trim())) found.url = 'Enter the directory address, for example ldaps://dc1.example.org.';
  else if (s.url.trim().startsWith('ldap://') && !s.startTls && !/^ldap:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(s.url.trim())) {
    found.url = 'Plain LDAP sends passwords unencrypted: use ldaps://, or switch StartTLS on.';
  }
  if (!s.baseDn.trim()) found.baseDn = 'Enter the base DN, for example dc=example,dc=org.';
  if (!s.bindDn.trim() && !s.userDnTemplate.includes('{username}')) found.bindDn = 'Enter the service account DN (or, without one, a user DN template).';
  if (s.bindDn.trim() && !s.userFilter.includes('{username}')) found.userFilter = 'The filter must contain {username}.';
  if (s.bindDn.trim() && enabled && !hasSecret && !secret) found.secret = 'Enter the service account password before switching the provider on.';
  if (s.groupSource === 'search' && !s.groupFilter.includes('{dn}')) found.groupFilter = 'The filter must contain {dn}.';
  return found;
}

/** The connection: kind of directory, address, encryption, trust and the service account. */
export function LdapConnectionFields({ value, set, err, isNew, secret, setSecret, hasSecret }: {
  value: LdapState; set: (patch: Partial<LdapState>) => void; err: (k: string) => string | undefined; isNew: boolean;
  secret: string; setSecret: (v: string) => void; hasSecret: boolean;
}) {
  const ldapUrl = value.url.trim().startsWith('ldap://');
  return (
    <>
      <Select
        label="Kind of directory" required value={value.directory} options={DIRECTORIES} error={err('directory')}
        onChange={(v) => {
          const directory = v as LdapState['directory'];
          // A new provider takes the defaults of the kind chosen; an existing one keeps its settings.
          set(isNew ? { directory, ...PRESETS[directory] } : { directory });
        }}
        hint={isNew ? 'Fills in the usual search filter and attributes below; change them if your directory differs.' : undefined}
      />
      <TextField label="Directory address" required value={value.url} onChange={(v) => set({ url: v })} error={err('url')}
        hint="ldaps://host (port 636), or ldap://host (port 389) with StartTLS below. Plain LDAP is refused: it would send passwords unencrypted. Add :port for another port." />
      <Checkbox label="Use StartTLS (for an ldap:// address)" checked={value.startTls} onChange={(v) => set({ startTls: v })} disabled={!ldapUrl && !value.startTls}
        hint="The connection is encrypted before anything else is sent. Not needed with ldaps://." />
      <TextArea label="Trust only this CA certificate (optional)" rows={3} maxRows={10} value={value.caCert} onChange={(v) => set({ caCert: v })} error={err('caCert')}
        placeholder="-----BEGIN CERTIFICATE-----"
        hint="PEM. Usually your organization's own CA, which issued the directory's certificate; the directory's own certificate also works. When set, no other certificate is trusted. Empty: the system's trusted CAs. The host name is always checked." />
      <TextField label="Service account DN" value={value.bindDn} onChange={(v) => set({ bindDn: v })} error={err('bindDn')}
        placeholder="cn=grc-sign-in,ou=service accounts,dc=example,dc=org"
        hint="An account that may read people's entries (and their groups); it never needs to change anything. Use one made for this application." />
      {value.bindDn.trim() ? (
        <TextField
          label="Service account password" type="password" autoComplete="new-password" value={secret} onChange={setSecret} error={err('secret')}
          hint={hasSecret ? 'A password is stored (encrypted). Leave empty to keep it; type a new one to replace it.' : 'Stored encrypted with the application key. It is never shown again.'}
        />
      ) : (
        <TextField label="User DN template (without a service account)" value={value.userDnTemplate} onChange={(v) => set({ userDnTemplate: v })} error={err('userDnTemplate')}
          placeholder="uid={username},ou=people,dc=example,dc=org"
          hint="Only for a directory where every person's DN follows one pattern and people may read their own entry. {username} is escaped." />
      )}
    </>
  );
}

/** How a person is found and recognized. */
export function LdapIdentityFields({ value, set, err, trustEmail, setTrustEmail }: {
  value: LdapState; set: (patch: Partial<LdapState>) => void; err: (k: string) => string | undefined;
  trustEmail: boolean; setTrustEmail: (v: boolean) => void;
}) {
  return (
    <>
      <TextField label="Base DN" required value={value.baseDn} onChange={(v) => set({ baseDn: v })} error={err('baseDn')}
        placeholder="dc=example,dc=org" hint="Where people are searched for (with everything below it)." />
      <TextField label="User search filter" required value={value.userFilter} onChange={(v) => set({ userFilter: v })} error={err('userFilter')}
        hint="{username} is what the person types, escaped so that it can only ever be one value. Exactly one entry must match. Add conditions to leave out, for example, service accounts." />
      <TextField label="Identifier attribute" required value={value.idAttribute} onChange={(v) => set({ idAttribute: v })} error={err('idAttribute')}
        hint="An attribute that never changes for the person, even when they are renamed or moved: objectGUID (Active Directory) or entryUUID (OpenLDAP). It links the entry to an account here." />
      <TextField label="Email attribute" value={value.emailAttribute} onChange={(v) => set({ emailAttribute: v })} error={err('emailAttribute')} hint="Usually mail." />
      <Checkbox label="Trust the email addresses in this directory" checked={trustEmail} onChange={setTrustEmail}
        hint="Matching an existing account by email, and creating accounts, need this. Switch it on only for your organization's own directory." />
      <TextField label="Display name attribute" value={value.nameAttribute} onChange={(v) => set({ nameAttribute: v })} error={err('nameAttribute')}
        hint="Used for the name of an account created at first sign-in." />
    </>
  );
}

/** Where groups come from, for role mapping. */
export function LdapGroupFields({ value, set, err }: { value: LdapState; set: (patch: Partial<LdapState>) => void; err: (k: string) => string | undefined }) {
  return (
    <>
      <Select label="Groups come from" required value={value.groupSource} options={GROUP_SOURCES} onChange={(v) => set({ groupSource: v as LdapState['groupSource'] })} error={err('groupSource')} />
      {value.groupSource === 'search' && (
        <>
          <TextField label="Group search filter" required value={value.groupFilter} onChange={(v) => set({ groupFilter: v })} error={err('groupFilter')}
            hint="{dn} is the person's DN (and {username} what they typed), both escaped." />
          <TextField label="Group base DN (optional)" value={value.groupBaseDn} onChange={(v) => set({ groupBaseDn: v })} error={err('groupBaseDn')}
            hint="Where groups are searched for. Empty: the base DN." />
        </>
      )}
      <Checkbox label="Include nested groups (Active Directory)" checked={value.nestedGroups} onChange={(v) => set({ nestedGroups: v })}
        hint="Also the groups the person is in through other groups, worked out by the directory (LDAP_MATCHING_RULE_IN_CHAIN). Active Directory only." />
      <p className="muted adm-small">A rule's group value is the group's full DN, as the directory gives it, for example cn=Dispatch,ou=Groups,dc=example,dc=org. "Test connection" with a user name lists a person's groups to copy from.</p>
    </>
  );
}
