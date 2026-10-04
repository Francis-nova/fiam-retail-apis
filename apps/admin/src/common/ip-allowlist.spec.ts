import { isIpAllowed, parseAllowedIps } from './ip-allowlist';

describe('ADMIN_ALLOWED_IPS', () => {
  it('is not enforced when unset or blank', () => {
    expect(parseAllowedIps(undefined)).toBeNull();
    expect(parseAllowedIps('')).toBeNull();
    expect(parseAllowedIps(' , ')).toBeNull();
  });

  it('matches single IPs and CIDR ranges', () => {
    const r = parseAllowedIps('203.0.113.7, 198.51.100.0/24')!;
    expect(isIpAllowed('203.0.113.7', r)).toBe(true);
    expect(isIpAllowed('203.0.113.8', r)).toBe(false);
    expect(isIpAllowed('198.51.100.200', r)).toBe(true);
    expect(isIpAllowed('198.51.101.1', r)).toBe(false);
  });

  it('treats IPv4-mapped IPv6 sockets as their IPv4 address', () => {
    const r = parseAllowedIps('203.0.113.7')!;
    expect(isIpAllowed('::ffff:203.0.113.7', r)).toBe(true);
    expect(isIpAllowed('::ffff:203.0.113.9', r)).toBe(false);
  });

  it('supports IPv6 ranges and never mixes address families', () => {
    const r = parseAllowedIps('2001:db8::/32')!;
    expect(isIpAllowed('2001:db8::1', r)).toBe(true);
    expect(isIpAllowed('2001:db9::1', r)).toBe(false);
    expect(isIpAllowed('10.0.0.1', r)).toBe(false);
  });

  it('denies a missing or garbage address', () => {
    const r = parseAllowedIps('203.0.113.7')!;
    expect(isIpAllowed(undefined, r)).toBe(false);
    expect(isIpAllowed('not-an-ip', r)).toBe(false);
  });

  it('fails fast on a malformed entry', () => {
    expect(() => parseAllowedIps('203.0.113.7, 999.1.1.1')).toThrow(
      /invalid entry/,
    );
    expect(() => parseAllowedIps('10.0.0.0/99')).toThrow(/invalid entry/);
  });
});
