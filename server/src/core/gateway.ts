import { readFileSync } from 'node:fs';

// GRC_TRUST_PROXY=gateway (SP-03), for containers. A reverse proxy on the Docker host reaches the
// published port through Docker's port forwarder, so the container sees every such connection come
// from its network's gateway: the host's own address on the container network. `gateway` trusts that
// one address (found from the container's default route at start), not every private address:
// people on the organization's network have private addresses too, and must not be able to set
// X-Forwarded-For themselves. A proxy in another container is named by its own address instead.

/** The IPv4 default gateway in the text of /proc/net/route, or null when there is none. */
export function defaultGatewayFrom(routeTable: string): string | null {
  for (const line of routeTable.split('\n').slice(1)) {
    const [, destination, gateway, flags] = line.trim().split(/\s+/);
    if (destination !== '00000000' || !gateway || !/^[0-9A-Fa-f]{8}$/.test(gateway)) continue;
    // RTF_UP (1) and RTF_GATEWAY (2)
    if ((parseInt(flags ?? '0', 16) & 3) !== 3) continue;
    // Stored in the machine's byte order, which is little-endian on every platform Docker runs on.
    const n = parseInt(gateway, 16);
    return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24].join('.');
  }
  return null;
}

/** The container's default gateway (Linux), or null when it cannot be found. */
export function defaultGateway(read: () => string = () => readFileSync('/proc/net/route', 'utf8')): string | null {
  try {
    return defaultGatewayFrom(read());
  } catch {
    return null;
  }
}

/**
 * GRC_TRUST_PROXY with the word `gateway` replaced by the gateway's address. Without a gateway the
 * word is dropped, so nothing more is trusted than was asked for. Returns the new value and a note
 * for the log.
 */
export function resolveGatewayKeyword(value: string | undefined, gateway: () => string | null = defaultGateway): { value: string | undefined; note: string | null } {
  if (!value) return { value, note: null };
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === 'gateway')) return { value, note: null };
  const address = gateway();
  const rest = parts.filter((p) => p.toLowerCase() !== 'gateway');
  if (!address) {
    return { value: rest.join(',') || 'off', note: 'GRC_TRUST_PROXY: no default gateway found, so "gateway" trusts nobody; forwarded headers from it are ignored.' };
  }
  return { value: [address, ...rest].join(','), note: `GRC_TRUST_PROXY: "gateway" is ${address}; forwarded headers are believed from it only${rest.length ? ` and from ${rest.join(', ')}` : ''}.` };
}

/** Whether a GRC_TRUST_PROXY value trusts every private address (the `private` keyword). */
export const trustsAllPrivate = (value: string | undefined) =>
  String(value ?? '').split(',').some((p) => p.trim().toLowerCase() === 'private');
