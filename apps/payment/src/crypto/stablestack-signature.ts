import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 5 * 60 * 1000;

// StableStack signs `${t}.${JSON.stringify(payloadWithoutSignature)}` with
// HMAC-SHA256 and puts `t=<ms>,s=<hex>` in the body's `signature` field
// (https://docs.stablestack.com/webhooks/security). Re-serialising the parsed
// body matches theirs because JSON.parse keeps key order.
export function isValidStableStackSignature(
  body: Record<string, unknown>,
  secret: string,
  now = Date.now(),
): boolean {
  const { signature, ...rest } = body;
  if (typeof signature !== 'string' || !secret) return false;
  const match = /^t=(\d+),s=([0-9a-f]{64})$/i.exec(signature);
  if (!match) return false;
  const [, t, received] = match;
  if (Math.abs(now - Number(t)) > MAX_AGE_MS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${t}.${JSON.stringify(rest)}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(received, 'hex'));
}
