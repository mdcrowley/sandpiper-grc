// Sign-in providers: the shapes every kind of provider shares.
//
// A provider is one way of proving who someone is, besides the local password: an OpenID Connect
// identity provider today; a SAML 2.0 identity provider or a directory (LDAP) later. Each kind is a
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
  remember: { nonce: string; codeVerifier: string };
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
 * - `credentials` providers (a directory, LDAP; not built) check a username and password typed into the
 *   sign-in page: `authenticate`. The local sign-in form would offer them as a choice.
 */
export interface ProviderDriver {
  type: string;
  /** Plain name of the kind, for screens ("OpenID Connect"). */
  label: string;
  style: 'redirect' | 'credentials';
  /** Checks and cleans an administrator's input. Returns field errors keyed as the input. */
  cleanConfig(input: Record<string, unknown>, existing: Record<string, any> | null): { config: Record<string, any>; fields: Record<string, string> };
  /** Fetches whatever proves the settings work (discovery for OpenID Connect). Only when an administrator asks. */
  test(provider: ProviderRecord, secret: string | null): Promise<TestResult>;
  start?(provider: ProviderRecord, opts: { redirectUri: string; state: string; reauth: boolean }): Promise<RedirectStart>;
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
