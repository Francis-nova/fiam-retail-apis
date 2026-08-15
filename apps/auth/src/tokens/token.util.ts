import { randomBytes } from 'crypto';
import { sha256 } from '@app/common';

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return sha256(token);
}

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// Parses simple durations like "15m", "30d" — the same shorthand @nestjs/jwt's
// `expiresIn` accepts, so JWT_ACCESS_TTL/JWT_REFRESH_TTL only need one format.
export function addDuration(base: Date, duration: string): Date {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration string: ${duration}`);
  }
  const [, amountStr, unit] = match;
  return new Date(base.getTime() + Number(amountStr) * DURATION_UNIT_MS[unit]);
}
