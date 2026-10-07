import { createHmac, timingSafeEqual } from 'crypto';

// QoreID signs every webhook with HMAC-SHA512 over the raw request body, keyed
// by the webhook secret configured in its dashboard, hex-encoded, and sends it
// in the `x-verifyme-signature` header
// (https://docs.qoreid.com/docs/webhook-configuration).
export const QOREID_SIGNATURE_HEADER = 'x-verifyme-signature';

export function computeQoreIdSignature(
  rawBody: Buffer | string,
  secret: string,
): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

/** Constant-time check of the signature header against the raw body. */
export function isValidQoreIdSignature(
  header: string | string[] | undefined,
  rawBody: Buffer | string,
  secret: string,
): boolean {
  if (typeof header !== 'string' || !secret) return false;
  const expected = Buffer.from(computeQoreIdSignature(rawBody, secret), 'hex');
  const provided = Buffer.from(header.trim().toLowerCase(), 'hex');
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
