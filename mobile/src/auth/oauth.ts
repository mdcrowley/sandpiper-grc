// OAuth 2.1 for a native app (RFC 8252): the authorization request with PKCE (S256), the redirect back to
// the app, and the token endpoint (code exchange, refresh with rotation, revocation). Pure except the
// fetches; the browser sheet is opened by session.ts. Shapes: shared/mobile-api.ts.
import type {
  DevicePlatform, MobileHello, MobileTokenResponse, OAuthError,
} from '../../../shared/mobile-api.ts';

/** base64url without padding (RFC 4648 §5), as PKCE needs. */
export function base64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]! + alphabet[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += alphabet[(n >> 18) & 63]! + alphabet[(n >> 12) & 63]! + alphabet[(n >> 6) & 63]!;
  }
  return out;
}

export interface Crypto {
  randomBytes(n: number): Uint8Array;
  sha256(text: string): Promise<Uint8Array>;
}

export interface PkcePair { verifier: string; challenge: string; state: string }

/** A fresh code verifier (43 characters from 32 random bytes), its S256 challenge and a state value. */
export async function makePkce(crypto: Crypto): Promise<PkcePair> {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(await crypto.sha256(verifier));
  const state = base64Url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export interface DeviceInfo {
  installationId: string;
  deviceName: string;
  platform: DevicePlatform;
  appVersion: string;
}

/** The authorization address opened in the system browser sheet (MobileAuthorizeQuery). */
export function authorizeUrl(hello: MobileHello, pkce: PkcePair, device: DeviceInfo, opts: { promptLogin?: boolean } = {}): string {
  const q: Record<string, string> = {
    response_type: 'code',
    client_id: hello.oauth.clientId,
    redirect_uri: hello.oauth.redirectUri,
    scope: hello.oauth.scope,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    installation_id: device.installationId,
    device_name: device.deviceName.slice(0, 80),
    device_platform: device.platform,
    app_version: device.appVersion,
  };
  if (opts.promptLogin) q.prompt = 'login';
  const query = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const sep = hello.oauth.authorizationEndpoint.includes('?') ? '&' : '?';
  return `${hello.oauth.authorizationEndpoint}${sep}${query}`;
}

export type RedirectOutcome = { ok: true; code: string } | { ok: false; error: string; description?: string };

/** Reads `com.sandpipergrc:/oauth?code=...&state=...`; a wrong state is refused (a forged redirect). */
export function parseRedirect(url: string, expectedState: string): RedirectOutcome {
  const qIndex = url.indexOf('?');
  const params: Record<string, string> = {};
  if (qIndex >= 0) {
    for (const pair of url.slice(qIndex + 1).split('#')[0]!.split('&')) {
      if (!pair) continue;
      const [k, v = ''] = pair.split('=');
      params[decodeURIComponent(k!)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
  }
  if (params.state !== expectedState) return { ok: false, error: 'state_mismatch' };
  if (params.error) return { ok: false, error: params.error, description: params.error_description };
  if (!params.code) return { ok: false, error: 'invalid_request' };
  return { ok: true, code: params.code };
}

/** A refusal from the token endpoint. `invalid_grant` on a refresh means the device was signed out. */
export class TokenError extends Error {
  constructor(public status: number, public error: OAuthError['error'] | 'network' | 'bad_response', description?: string) {
    super(description ?? error);
    this.name = 'TokenError';
  }
}

function form(body: Record<string, string>): string {
  return Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function postForm(fetcher: typeof fetch, endpoint: string, body: Record<string, string>): Promise<Response> {
  try {
    return await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form(body),
    });
  } catch {
    throw new TokenError(0, 'network');
  }
}

async function tokenAnswer(res: Response): Promise<MobileTokenResponse> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = (body ?? {}) as Partial<OAuthError>;
    throw new TokenError(res.status, e.error ?? 'bad_response', e.error_description);
  }
  const t = body as Partial<MobileTokenResponse> | null;
  if (!t || typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string' || typeof t.expires_in !== 'number') {
    throw new TokenError(res.status, 'bad_response');
  }
  return t as MobileTokenResponse;
}

export async function exchangeCode(
  hello: MobileHello, code: string, verifier: string, installationId: string, fetcher: typeof fetch = fetch,
): Promise<MobileTokenResponse> {
  const res = await postForm(fetcher, hello.oauth.tokenEndpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: hello.oauth.redirectUri,
    client_id: hello.oauth.clientId,
    code_verifier: verifier,
    installation_id: installationId,
  });
  return tokenAnswer(res);
}

export async function refreshTokens(
  tokenEndpoint: string, clientId: string, refreshToken: string, installationId: string, fetcher: typeof fetch = fetch,
): Promise<MobileTokenResponse> {
  const res = await postForm(fetcher, tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    installation_id: installationId,
  });
  return tokenAnswer(res);
}

/** Revokes the device session (best effort: the server always answers 200, and offline is fine). */
export async function revokeToken(revocationEndpoint: string, clientId: string, token: string, fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await postForm(fetcher, revocationEndpoint, { token, client_id: clientId, token_type_hint: 'refresh_token' });
  } catch {
    // Signing out never waits on the network; the server signs the device out when the token lapses.
  }
}
