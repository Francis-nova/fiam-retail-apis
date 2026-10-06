import * as OTPAuth from 'otpauth';
import { TotpService } from './totp.service';

const KEY = 'a'.repeat(64);
const config = {
  get: () => ({ encryptionKey: KEY, issuer: 'Fiam Console', required: false }),
} as never;

function codeFor(secretBase32: string, offsetSteps = 0) {
  const t = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return t.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

describe('TotpService', () => {
  const svc = new TotpService(config);

  it('encrypts at rest and round-trips', () => {
    const packed = svc.encrypt('JBSWY3DPEHPK3PXP');
    expect(packed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(svc.decrypt(packed)).toBe('JBSWY3DPEHPK3PXP');
    // Fresh IV every time.
    expect(svc.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(packed);
  });

  it('rejects tampered ciphertext', () => {
    const [iv, tag, ct] = svc.encrypt('secret').split('.');
    const bad = [iv, tag, Buffer.from('x' + ct).toString('base64url')].join(
      '.',
    );
    expect(() => svc.decrypt(bad)).toThrow();
  });

  it('builds an otpauth URL naming the issuer and account', () => {
    const { otpauthUrl } = svc.newSecret('ada@fiam.ng');
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(otpauthUrl)).toContain('ada@fiam.ng');
    expect(otpauthUrl).toContain('Fiam%20Console');
  });

  it('accepts the current code and one step of drift, nothing else', () => {
    const { secret, encrypted } = svc.newSecret('a@b.c');
    const nowStep = Math.floor(Date.now() / 1000 / 30);
    expect(svc.verify(encrypted, codeFor(secret))).toBe(nowStep);
    expect(svc.verify(encrypted, codeFor(secret, -1))).toBe(nowStep - 1);
    expect(svc.verify(encrypted, codeFor(secret, 1))).toBe(nowStep + 1);
    expect(svc.verify(encrypted, codeFor(secret, 3))).toBeNull();
    expect(svc.verify(encrypted, '000000')).toBeNull();
  });

  it('rejects anything that is not exactly six digits', () => {
    const { encrypted } = svc.newSecret('a@b.c');
    for (const bad of ['12345', '1234567', 'abcdef', '', '12 345']) {
      expect(svc.verify(encrypted, bad)).toBeNull();
    }
  });

  it('issues ten unambiguous, unique recovery codes and stores only hashes', () => {
    const { codes, hashes } = svc.newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes)
      expect(c).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
    expect(hashes).toEqual(codes.map((c) => svc.hashRecovery(c)));
    expect(hashes.join()).not.toContain(codes[0]);
  });

  it('matches recovery codes regardless of case, spaces and dash', () => {
    const { codes } = svc.newRecoveryCodes();
    const c = codes[0];
    expect(svc.hashRecovery(c.toUpperCase())).toBe(svc.hashRecovery(c));
    expect(svc.hashRecovery(c.replace('-', ' '))).toBe(svc.hashRecovery(c));
    expect(svc.hashRecovery(c.replace('-', ''))).toBe(svc.hashRecovery(c));
  });
});
