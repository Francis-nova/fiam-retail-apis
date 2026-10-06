import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as OTPAuth from 'otpauth';
import { sha256 } from '@app/common';
import { AdminConfig } from '../config/configuration';

const PERIOD = 30;
const RECOVERY_CODE_COUNT = 10;
// No 0/O/1/I/L so a code read off a printout can't be misread.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService<AdminConfig, true>) {}

  private get key(): Buffer {
    return Buffer.from(
      this.config.get('totp', { infer: true }).encryptionKey,
      'hex',
    );
  }

  // AES-256-GCM, packed as iv.tag.ciphertext (base64url).
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ct]
      .map((b) => b.toString('base64url'))
      .join('.');
  }

  decrypt(packed: string): string {
    const [iv, tag, ct] = packed
      .split('.')
      .map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  }

  private totp(secretBase32: string, label: string) {
    return new OTPAuth.TOTP({
      issuer: this.config.get('totp', { infer: true }).issuer,
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  /** A fresh secret for enrolment, plus the otpauth:// URL for the QR code. */
  newSecret(label: string): {
    secret: string;
    otpauthUrl: string;
    encrypted: string;
  } {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    return {
      secret,
      otpauthUrl: this.totp(secret, label).toString(),
      encrypted: this.encrypt(secret),
    };
  }

  /**
   * Checks a 6-digit code (±1 step of clock drift). Returns the matched time
   * step so the caller can refuse to accept the same step twice (replay), or
   * null when the code is wrong.
   */
  verify(encryptedSecret: string, code: string): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const delta = this.totp(this.decrypt(encryptedSecret), 'x').validate({
      token: code,
      window: 1,
    });
    if (delta === null) return null;
    return Math.floor(Date.now() / 1000 / PERIOD) + delta;
  }

  /** Ten single-use codes, shown once; only their hashes are stored. */
  newRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = Array.from(
        { length: 10 },
        () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
      ).join('');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map((c) => this.hashRecovery(c)) };
  }

  hashRecovery(code: string): string {
    return sha256(code.replace(/[\s-]/g, '').toLowerCase());
  }
}
