import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import {
  computeQoreIdSignature,
  isValidQoreIdSignature,
} from './qoreid-signature';

const SECRET = 'test-webhook-secret';

function controller(secret = SECRET) {
  const config = {
    get: jest.fn().mockReturnValue(secret),
  } as unknown as ConfigService<never, true>;
  return new QoreIdWebhookController(config);
}
const req = (raw?: string) => ({ rawBody: raw ? Buffer.from(raw) : undefined });

describe('QoreID webhook signature', () => {
  it('matches HMAC-SHA512 hex of the raw body', () => {
    const sig = computeQoreIdSignature('{}', SECRET);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(isValidQoreIdSignature(sig, '{}', SECRET)).toBe(true);
    expect(isValidQoreIdSignature(sig.toUpperCase(), '{}', SECRET)).toBe(true);
  });

  it('rejects a wrong secret, a changed body, a missing or malformed header', () => {
    const sig = computeQoreIdSignature('{}', SECRET);
    expect(isValidQoreIdSignature(sig, '{}', 'other')).toBe(false);
    expect(isValidQoreIdSignature(sig, '{"a":1}', SECRET)).toBe(false);
    expect(isValidQoreIdSignature(undefined, '{}', SECRET)).toBe(false);
    expect(isValidQoreIdSignature('not-hex', '{}', SECRET)).toBe(false);
    expect(isValidQoreIdSignature(sig.slice(0, 20), '{}', SECRET)).toBe(false);
    expect(isValidQoreIdSignature(sig, '{}', '')).toBe(false);
  });
});

describe('QoreIdWebhookController', () => {
  it("accepts QoreID's empty {} test ping with a valid signature", () => {
    const sig = computeQoreIdSignature('{}', SECRET);
    expect(controller().handle(req('{}') as never, sig, {})).toEqual({
      status: 'received',
    });
  });

  it('accepts a real event payload', () => {
    const raw = JSON.stringify({ event: 'verification', status: 'verified' });
    const sig = computeQoreIdSignature(raw, SECRET);
    expect(
      controller().handle(req(raw) as never, sig, JSON.parse(raw) as never),
    ).toEqual({ status: 'received' });
  });

  it('401s on a bad or missing signature', () => {
    expect(() =>
      controller().handle(req('{}') as never, 'deadbeef', {}),
    ).toThrow(UnauthorizedException);
    expect(() =>
      controller().handle(req('{}') as never, undefined, {}),
    ).toThrow(UnauthorizedException);
  });

  it('503s when no secret is configured, 400s when the raw body is missing', () => {
    expect(() => controller('').handle(req('{}') as never, 'x', {})).toThrow(
      ServiceUnavailableException,
    );
    expect(() =>
      controller().handle(
        req() as never,
        computeQoreIdSignature('{}', SECRET),
        {},
      ),
    ).toThrow(BadRequestException);
  });
});
