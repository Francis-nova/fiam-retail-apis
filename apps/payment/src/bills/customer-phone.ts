import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConfig } from '../config/configuration';

const AUTH_LOOKUP_TIMEOUT_MS = 5_000;

// Auth stores phones as 234XXXXXXXXXX; VFD's bills API takes the local form
// (0XXXXXXXXXX, as in its own examples). Anything that isn't a Nigerian
// mobile in the stored shape yields null rather than a guess.
export function toLocalNigerianPhone(stored: string | null | undefined) {
  const digits = (stored ?? '').replace(/\D/g, '');
  return /^234[789]\d{9}$/.test(digits) ? `0${digits.slice(3)}` : null;
}

// The customer's phone lives in apps/auth, not here — same internal
// (shared-secret) lookup the receipt emails use. Used to fill in a bill's
// phoneNumber when the customer didn't give one. Never throws: a missing
// number just means the field stays empty, as before.
@Injectable()
export class CustomerPhoneService {
  private readonly logger = new Logger(CustomerPhoneService.name);

  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  async lookup(userId: string): Promise<string | null> {
    const { internalUrl, internalApiKey } = this.configService.get('auth', {
      infer: true,
    });
    if (!internalApiKey) return null;
    try {
      const response = await fetch(
        `${internalUrl}/internal/users/${encodeURIComponent(userId)}/contact`,
        {
          headers: { 'x-internal-key': internalApiKey },
          signal: AbortSignal.timeout(AUTH_LOOKUP_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          `Auth phone lookup for ${userId} failed: ${response.status}`,
        );
        return null;
      }
      const body = (await response.json()) as { phone?: string | null };
      return toLocalNigerianPhone(body.phone);
    } catch (err) {
      this.logger.warn(
        `Auth phone lookup for ${userId} failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
