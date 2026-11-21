import { describe, expect, it } from 'vitest';
import { defaultGatewayFrom, resolveGatewayKeyword, trustsAllPrivate } from './gateway.ts';
import { parseTrustProxy } from './http.ts';

// SP-03: the container default trusted every private address, so anyone on the organization's
// network could choose the address recorded for them. It now trusts the Docker host only.
const ROUTES = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
].join('\n');

describe('GRC_TRUST_PROXY=gateway (SP-03)', () => {
  it('reads the default gateway from the route table', () => {
    expect(defaultGatewayFrom(ROUTES)).toBe('172.18.0.1');
    expect(defaultGatewayFrom(ROUTES.split('\n').filter((l) => !l.includes('010012AC')).join('\n'))).toBeNull();
  });

  it('trusts the gateway only, not other private addresses', () => {
    const { value, note } = resolveGatewayKeyword('gateway', () => '172.18.0.1');
    expect(value).toBe('172.18.0.1');
    expect(note).toMatch(/172\.18\.0\.1/);
    const trusted = parseTrustProxy(value);
    expect(trusted('172.18.0.1', 0)).toBe(true);
    expect(trusted('10.20.30.40', 0)).toBe(false); // a person on the intranet
    expect(trusted('172.18.0.7', 0)).toBe(false); // another container
  });

  it('keeps other entries, and trusts nobody when there is no gateway', () => {
    expect(resolveGatewayKeyword('gateway, 10.0.0.5', () => '172.18.0.1').value).toBe('172.18.0.1,10.0.0.5');
    expect(resolveGatewayKeyword('gateway', () => null).value).toBe('off');
    expect(resolveGatewayKeyword('loopback', () => '172.18.0.1')).toEqual({ value: 'loopback', note: null });
    expect(resolveGatewayKeyword(undefined)).toEqual({ value: undefined, note: null });
  });

  it('recognizes the "private" keyword (warned about when the server speaks HTTPS itself)', () => {
    expect(trustsAllPrivate('private')).toBe(true);
    expect(trustsAllPrivate('loopback, Private')).toBe(true);
    expect(trustsAllPrivate('172.18.0.1')).toBe(false);
  });
});
