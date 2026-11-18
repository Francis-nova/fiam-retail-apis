import { createHmac, timingSafeEqual } from 'crypto';

const MAX_AGE_MS = 5 * 60 * 1000;

// Mirrors https://docs.stablestack.com/webhooks/security: the body's
// `signature` is "t=<ms>,s=<hex>", where s = HMAC-SHA256 of
// `${t}.${JSON.stringify(payloadWithoutSignature)}`. JSON.parse keeps key
// order, so re-serialising the parsed body reproduces what they signed.
export function isValidStableStackSignature(
  body: Record<string, unknown>,
  secret: string,
  now = Date.now(),
): boolean {
  const { signature, ...payloadWithoutSignature } = body;
  if (typeof signature !== 'string' || !secret) return false;

  const parts = signature.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const receivedSig = parts.find((p) => p.startsWith('s='))?.slice(2);
  if (!timestamp || !receivedSig) return false;

  const eventTime = parseInt(timestamp, 10);
  if (!Number.isFinite(eventTime) || Math.abs(now - eventTime) > MAX_AGE_MS) {
    return false;
  }

  const expectedBuf = createHmac('sha256', secret)
    .update(`${timestamp}.${JSON.stringify(payloadWithoutSignature)}`)
    .digest();
  const receivedBuf = Buffer.from(receivedSig, 'hex');
  return (
    expectedBuf.length === receivedBuf.length &&
    timingSafeEqual(expectedBuf, receivedBuf)
  );
}
