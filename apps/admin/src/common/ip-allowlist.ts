import ipaddr from 'ipaddr.js';
import type { NextFunction, Request, Response } from 'express';

type Range = [ipaddr.IPv4 | ipaddr.IPv6, number];

function normalise(addr: ipaddr.IPv4 | ipaddr.IPv6) {
  // Behind Traefik the socket address is often IPv4-mapped IPv6 (::ffff:1.2.3.4).
  return addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()
    ? (addr as ipaddr.IPv6).toIPv4Address()
    : addr;
}

/**
 * Parses `ADMIN_ALLOWED_IPS` ("203.0.113.7, 198.51.100.0/24, 2001:db8::/32").
 * Empty/unset → null, meaning the allowlist is NOT enforced. A malformed
 * entry throws so a typo fails the boot instead of silently locking everyone
 * out (or, worse, being skipped and leaving a hole).
 */
export function parseAllowedIps(raw: string | undefined): Range[] | null {
  const entries = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return entries.map((entry) => {
    try {
      if (entry.includes('/')) {
        const [addr, bits] = ipaddr.parseCIDR(entry);
        return [normalise(addr), bits] as Range;
      }
      const addr = normalise(ipaddr.parse(entry));
      return [addr, addr.kind() === 'ipv4' ? 32 : 128] as Range;
    } catch {
      throw new Error(`ADMIN_ALLOWED_IPS has an invalid entry: "${entry}"`);
    }
  });
}

export function isIpAllowed(ip: string | undefined, ranges: Range[]): boolean {
  if (!ip || !ipaddr.isValid(ip)) return false;
  const addr = normalise(ipaddr.parse(ip));
  return ranges.some(
    ([range, bits]) => range.kind() === addr.kind() && addr.match(range, bits),
  );
}

/** Express middleware: 403 for any caller outside the allowlist (except /health). */
export function ipAllowlist(ranges: Range[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Liveness probe only — returns nothing sensitive and the container's
    // own healthcheck comes from loopback.
    if (req.path === '/health') return next();
    if (isIpAllowed(req.ip, ranges)) return next();
    res.status(403).json({ statusCode: 403, message: 'Forbidden' });
  };
}
