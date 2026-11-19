import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { isHttps } from '../request.ts';

/**
 * Where passkeys are bound. A passkey works only for the relying-party ID (a host name) it was
 * registered for, and the browser reports the page's origin, which must be one of ours.
 *
 *   GRC_WEBAUTHN_RP_ID     host name, e.g. grc.example.org (default: the host the request was sent to)
 *   GRC_WEBAUTHN_ORIGINS   comma-separated origins, e.g. https://grc.example.org
 *                          (default: the scheme and host the request was sent to)
 *
 * The defaults suit the local prototype, reached at http://localhost:<port>. Set both whenever the
 * application is reached through a proxy or by more than one name, so that a forged Host header
 * cannot change what is expected. Browsers refuse IP addresses as relying-party IDs, so passkeys do
 * not work at http://127.0.0.1:<port>: use http://localhost:<port> instead.
 */
export interface RelyingParty {
  rpId: string;
  origins: string[];
  /** Why passkeys cannot work at this address, or null. */
  problem: string | null;
}

const list = (v: string | undefined) => String(v ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

export function relyingParty(req: FastifyRequest): RelyingParty {
  const host = String(req.headers.host ?? '').trim().toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '');
  const rpId = String(process.env.GRC_WEBAUTHN_RP_ID ?? '').trim().toLowerCase() || hostname;
  const configured = list(process.env.GRC_WEBAUTHN_ORIGINS);
  const origins = configured.length ? configured : host ? [`${isHttps(req) ? 'https' : 'http'}://${host}`] : [];
  let problem: string | null = null;
  if (!rpId) problem = 'The address this application was reached at could not be worked out.';
  else if (isIP(rpId)) {
    problem = `Passkeys need a host name, and browsers refuse an IP address such as ${rpId}. `
      + (rpId === '127.0.0.1' || rpId === '::1' ? 'Open the application at http://localhost instead.' : 'Reach the application by its host name.');
  }
  return { rpId, origins, problem };
}
