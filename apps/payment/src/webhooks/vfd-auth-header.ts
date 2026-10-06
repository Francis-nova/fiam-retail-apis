import { timingSafeEqual } from 'crypto';

// VFD authenticates its webhook calls with `x-auth-token: vfd <token>`.
export const VFD_AUTH_HEADER = 'x-auth-token';
const PREFIX = 'vfd';

/** Constant-time check of the `x-auth-token` header against the configured token. */
export function isValidVfdAuthHeader(
  header: string | string[] | undefined,
  token: string,
): boolean {
  if (typeof header !== 'string' || !token) return false;
  const expected = Buffer.from(`${PREFIX} ${token}`);
  const provided = Buffer.from(header.trim());
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
