import { createHmac } from 'crypto';
import { isValidStableStackSignature } from './stablestack-signature';

const SECRET = 'whsec_test';
const T = 1778538982206;

// Signed exactly as StableStack's docs describe.
function signed(payload: Record<string, unknown>, t = T, secret = SECRET) {
  const s = createHmac('sha256', secret)
    .update(`${t}.${JSON.stringify(payload)}`)
    .digest('hex');
  return { ...payload, signature: `t=${t},s=${s}` };
}

const payload = {
  id: 'evt_a0b8f4cc-95c4-4c74-9b18-050813546eb5',
  timestamp: T,
  event_type: 'wallet.transaction.inbound',
  data: { amount: '20.00000000', status: 'COMPLETED' },
};

describe('isValidStableStackSignature', () => {
  it('accepts a correctly signed event', () => {
    expect(isValidStableStackSignature(signed(payload), SECRET, T)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const body = signed(payload);
    body.data = { amount: '2000.00000000', status: 'COMPLETED' };
    expect(isValidStableStackSignature(body, SECRET, T)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(isValidStableStackSignature(signed(payload), 'other', T)).toBe(
      false,
    );
  });

  it('rejects an event older than 5 minutes', () => {
    expect(
      isValidStableStackSignature(signed(payload), SECRET, T + 5 * 60_000 + 1),
    ).toBe(false);
  });

  it('rejects a missing or malformed signature', () => {
    expect(isValidStableStackSignature(payload, SECRET, T)).toBe(false);
    expect(
      isValidStableStackSignature({ ...payload, signature: 'nope' }, SECRET, T),
    ).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(isValidStableStackSignature(signed(payload), '', T)).toBe(false);
  });
});
