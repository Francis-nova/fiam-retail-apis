import { randomInt } from 'crypto';
import { sha256 } from '@app/common';

export function generateOtpCode(length: number): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return randomInt(min, max + 1)
    .toString()
    .padStart(length, '0');
}

export function hashOtpCode(code: string): string {
  return sha256(code);
}
