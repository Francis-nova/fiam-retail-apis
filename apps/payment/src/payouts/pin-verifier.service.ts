import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConfig } from '../config/configuration';

const AUTH_TIMEOUT_MS = 5_000;

// Outflow restriction reported by auth (CBN circular, 12 Mar 2026: new-device
// limit). `amount` is the cumulative cap over [since, until).
export interface TransferLimit {
  amount: string;
  since: string;
  until: string;
}

// The transaction PIN lives in apps/auth. Payouts ask it to check the PIN
// (over its internal, shared-secret API) as part of the request that moves
// the money, so the PIN can't be skipped by calling /payouts directly.
// Fails closed: if auth can't be reached, no money moves.
@Injectable()
export class PinVerifierService {
  private readonly logger = new Logger(PinVerifierService.name);

  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  async assertValid(
    userId: string,
    pin: string,
  ): Promise<{ transferLimit: TransferLimit | null }> {
    const { internalUrl, internalApiKey } = this.configService.get('auth', {
      infer: true,
    });
    if (!internalApiKey) {
      this.logger.error('INTERNAL_API_KEY is not set — refusing payout');
      throw new ServiceUnavailableException(
        'Payouts are temporarily unavailable',
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `${internalUrl}/internal/users/${encodeURIComponent(userId)}/verify-pin`,
        {
          method: 'POST',
          headers: {
            'x-internal-key': internalApiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ pin }),
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        },
      );
    } catch (err) {
      this.logger.error(
        `PIN check could not reach auth: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Payouts are temporarily unavailable',
      );
    }

    if (response.ok) {
      const body = (await response.json()) as {
        transferLimit?: TransferLimit | null;
      };
      return { transferLimit: body.transferLimit ?? null };
    }
    // 403, not 401: a wrong PIN here must not read as an expired session
    // (the app signs the customer out on any 401 from this API).
    if (response.status === 401) throw new ForbiddenException('Incorrect PIN');
    if (response.status === 429) {
      throw new HttpException(
        'Too many failed PIN attempts. Try again in 15 minutes.',
        429,
      );
    }
    this.logger.error(`PIN check failed unexpectedly: ${response.status}`);
    throw new ServiceUnavailableException(
      'Payouts are temporarily unavailable',
    );
  }

  // Read-only: the customer's current outflow restriction (no PIN involved).
  // Unlike the PIN check this is only informational, so it fails soft.
  async getTransferLimit(userId: string): Promise<TransferLimit | null> {
    const { internalUrl, internalApiKey } = this.configService.get('auth', {
      infer: true,
    });
    if (!internalApiKey) return null;
    try {
      const response = await fetch(
        `${internalUrl}/internal/users/${encodeURIComponent(userId)}/transfer-limit`,
        {
          headers: { 'x-internal-key': internalApiKey },
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        transferLimit?: TransferLimit | null;
      };
      return body.transferLimit ?? null;
    } catch {
      return null;
    }
  }
}
