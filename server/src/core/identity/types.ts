// Sign-in providers: the shapes every kind of provider shares.
//
// A provider is one way of proving who someone is, besides the local password: an OpenID Connect
// identity provider, a SAML 2.0 identity provider or a directory (LDAP). Each kind is a
// `ProviderDriver`. Everything after "the provider says this is subject X with email Y and groups Z"
// (finding the account, linking, just-in-time creation, role mapping, sessions, audit) is shared and
// lives in `service.ts`, so a new kind only has to produce an `ExternalIdentity`.

/** What a provider asserts about the person after a successful sign-in. */
export interface ExternalIdentity {
  /** Stable, provider-unique identifier for the person (OIDC `sub`, SAML NameID, LDAP entry id). */
  subject: string;
  email: string | null;
  /** True only when the provider vouches for the email address (or the administrator chose to trust it). */
  emailVerified: boolean;
  displayName: string | null;
  /** Group or role values, for role mapping. Empty when the provider sends none. */
  groups: string[];
  /**
   * True when the provider said the person has groups but did not send them (too many: "group
   * overage", E02-24) and they could not be fetched. Role mapping then leaves roles as they are.
   */
  groupsUnknown?: boolean;
  /** How the provider says the person signed in (OIDC `amr`, RFC 8176), and the level reached (`acr`). */
  amr?: string[];
  acr?: string | null;
  /**
   * Directory sign-in (E02-30): the user name the person typed, kept with the linked identity so that
   * the confirmation dialog can fill it in. Never the password. Absent for OpenID Connect and SAML.
   */
  loginName?: string | null;
  /** The provider's session id (OIDC `sid`), for back-channel sign-out. */
  sid?: string | null;
  /** The raw ID token, kept (encrypted) only to name the session when signing out at the provider. Never logged. */
  idToken?: string | null;
  /** SAML (E02-10): the assertion's ID and how long it could be presented, so that it is accepted once only. */
  assertion?: { id: string; until: Date };
  /** SAML: the NameID and session index, kept (encrypted) only to name the session when signing out at the provider. */
  samlSession?: { nameId: string; format: string | null; nameQualifier: string | null; spNameQualifier: string | null; sessionIndex: string | null };
}

/** One mapping rule: people whose group claim holds `value` get role `role` (a role key). */
export interface RoleMapping { value: string; role: string }

/** Settings every kind of provider has (stored in `identity_providers.config`). */
export interface CommonProviderConfig {
  /** Optional role mapping. Off by default. */
  mappingEnabled: boolean;
  mappings: RoleMapping[];
  /** Optional just-in-time creation of accounts for unknown people. Off by default. */
  jitEnabled: boolean;
  /** Email domains allowed for just-in-time creation (lower case, no "@"). Required when jitEnabled. */
  jitDomains: string[];
  /** Treat the provider's email as verified even without `email_verified` (some directories never send it). */
  trustEmail: boolean;
  /**
   * E02-22: the provider enforces multi-factor sign-in. A session made through it satisfies this
   * application's second-factor requirement when its token shows it: an `amr` value in `mfaAmr`
   * (default `mfa`), or an `acr` in `mfaAcr`. Off by default.
   */
  providerMfa: boolean;
  mfaAmr: string[];
  mfaAcr: string[];
}

/** OpenID Connect settings. Issuer and endpoints are configuration; nothing is hard-coded. */
export interface OidcConfig extends CommonProviderConfig {
  issuer: string;
  clientId: string;
  /** Space-separated scopes; `openid` is always sent. */
  scopes: string;
  /** How the client authenticates at the token endpoint. `none` = public client (PKCE only). */
  tokenAuth: 'client_secret_basic' | 'client_secret_post' | 'none';
  /** Claim holding the email address (default `email`; some directories use `preferred_username` or `upn`). */
  emailClaim: string;
  /** Claim holding the display name (default `name`). */
  nameClaim: string;
  /** Claim holding groups or roles for role mapping (for example `groups` or `roles`). */
  groupsClaim: string;
  /** Signature algorithms accepted on ID tokens. */
  algorithms: ('RS256' | 'ES256' | 'PS256')[];
  /** Extra parameters for the authorization request (for example a domain hint). Never `client_id`, `state` and so on. */
  extraParams: Record<string, string>;
  /** E02-24: also read groups from the userinfo endpoint (always, not only when the token has too many to list). */
  groupsFromUserinfo: boolean;
  /** E02-23: signing out here also signs the person out at the provider (RP-initiated logout). Off by default. */
  endSession: boolean;
  /** E02-23: the provider may end sessions here by calling the back-channel logout address. Off by default. */
  backchannelLogout: boolean;
}

/** SAML 2.0 settings (E02-10). The identity provider's side comes from its metadata or is typed in. */
export interface SamlConfig extends CommonProviderConfig {
  /** The identity provider's entity ID (the Issuer of its responses). */
  idpEntityId: string;
  /** Its single sign-on address for the HTTP-Redirect binding. */
  ssoUrl: string;
  /** Its single logout address for the HTTP-Redirect binding, or empty. */
  sloUrl: string;
  /** Its signing certificates (PEM); more than one during a certificate change. Only these keys are trusted. */
  idpCerts: string[];
  /** This application's entity ID; empty means its metadata address. */
  spEntityId: string;
  /** This application's certificate for this provider (made when the provider is added; its key is the stored secret). */
  spCert: string;
  /** The name identifier format asked for. Transient identifiers are refused. */
  nameIdFormat: 'persistent' | 'email' | 'unspecified';
  /** Attributes holding the email address, the display name and groups; empty = the usual names (not for groups). */
  emailAttribute: string;
  nameAttribute: string;
  groupsAttribute: string;
  /** Sign the AuthnRequest (for a provider that wants signed requests). */
  signRequests: boolean;
  /** Require the assertion itself to be signed (otherwise a signed Response around it is enough). */
  wantAssertionsSigned: boolean;
  /** Ask for encrypted assertions (the metadata then offers an encryption key) and refuse unencrypted ones. */
  encryptAssertions: boolean;
  /** Signing out here also signs out at the provider (SP-initiated single logout). */
  endSession: boolean;
  /** E02-27: act on sign-outs the identity provider starts (LogoutRequest to the single logout address). Off by default. */
  idpLogout: boolean;
  /** E02-28: the identity provider's metadata address, for a scheduled refresh. */
  metadataUrl: string;
  /** E02-28: the certificate (PEM) that signs the metadata. When set, metadata must carry a valid signature by it. */
  metadataCert: string;
  /** E02-28: fetch the metadata again every day (outbound connections on, signed metadata only) and pick up new signing certificates. */
  metadataRefresh: boolean;
  /** E02-28: signing certificates the refreshed metadata no longer lists, by SHA-256 fingerprint: when they were first missing (kept a while for rollover). */
  certsDropped: Record<string, string>;
  /** E02-28: the last refresh: when, and what happened, in plain words. */
  metadataCheckedAt: string | null;
  metadataStatus: string;
}

/** Directory (LDAP) settings (E02-26). A credentials provider: the person types a directory user name and password here. */
export interface LdapConfig extends CommonProviderConfig {
  /** Which defaults the screen offered; nothing depends on it at sign-in. */
  directory: 'ad' | 'openldap' | 'other';
  /** ldaps://host[:port], or ldap://host[:port] with StartTLS. Plain LDAP only to 127.0.0.1 (tests). */
  url: string;
  startTls: boolean;
  /** PEM: trust only this CA certificate (or this very server certificate). Empty = the system trust store. */
  caCert: string;
  /** The service account that searches for people. Its password is the stored secret. Empty = bind with `userDnTemplate`. */
  bindDn: string;
  /** Without a service account: the person's DN, with {username} (DN-escaped), for example uid={username},ou=people,dc=example,dc=org. */
  userDnTemplate: string;
  /** Where people are searched for. */
  baseDn: string;
  /** The search for one person, with {username} (filter-escaped). */
  userFilter: string;
  /** The attribute that identifies the entry for good (objectGUID, entryUUID): what links it to an account here. */
  idAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  /** Where groups come from for role mapping: the entry's memberOf values, or a search for groups that list the person. */
  groupSource: 'memberOf' | 'search';
  groupBaseDn: string;
  /** The group search, with {dn} (the person's DN) and {username}, both filter-escaped. */
  groupFilter: string;
  /** Active Directory: include groups the person is in through other groups (LDAP_MATCHING_RULE_IN_CHAIN). */
  nestedGroups: boolean;
}

/** A provider row as the service uses it. `secret` is decrypted only when needed. */
export interface ProviderRecord {
  id: string;
  key: string;
  type: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  config: Record<string, any>;
  /** Encrypted client secret (`enc:v1:...`), or null. */
  secretSealed: string | null;
}

/** What starting a redirect sign-in produces: where to send the browser, and what to remember. */
export interface RedirectStart {
  url: string;
  /** Kept with the sign-in state and handed back to `complete`. Never sent to the browser. */
  remember: Record<string, string>;
}

/** The result of a "test connection": what was fetched, in plain words. */
export interface TestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * One kind of provider.
 *
 * - `redirect` providers (OpenID Connect, SAML) send the browser away and back: `start`, then `complete`
 *   with the parameters the provider returned.
 * - `credentials` providers (a directory, LDAP: E02-26) check a user name and password typed into the
 *   sign-in page: `authenticate`. The sign-in form offers them as a choice beside the local password.
 */
export interface ProviderDriver {
  type: string;
  /** Plain name of the kind, for screens ("OpenID Connect"). */
  label: string;
  style: 'redirect' | 'credentials';
  /** Checks and cleans an administrator's input. Returns field errors keyed as the input. */
  cleanConfig(input: Record<string, unknown>, existing: Record<string, any> | null): { config: Record<string, any>; fields: Record<string, string> };
  /** Fetches whatever proves the settings work (discovery for OpenID Connect). Only when an administrator asks. */
  test(provider: ProviderRecord, secret: string | null, opts?: { username?: string }): Promise<TestResult>;
  /** `secret` is the decrypted stored secret (SAML: the key that signs requests). */
  start?(provider: ProviderRecord, opts: { redirectUri: string; state: string; reauth: boolean; secret?: string | null }): Promise<RedirectStart>;
  complete?(
    provider: ProviderRecord, secret: string | null,
    opts: { params: Record<string, string>; redirectUri: string; remember: RedirectStart['remember'] },
  ): Promise<ExternalIdentity>;
  authenticate?(provider: ProviderRecord, secret: string | null, username: string, password: string): Promise<ExternalIdentity>;
  /** Forgets cached metadata (after the settings change). */
  forget?(provider: ProviderRecord): void;
}

/** A sign-in failure with a reason for the audit log; the person sees a generic message. */
export class IdentityError extends Error {
  /** Short reason recorded in the audit event ("bad signature", "wrong audience"). */
  reason: string;
  constructor(reason: string, message = reason) {
    super(message);
    this.name = 'IdentityError';
    this.reason = reason;
  }
}
