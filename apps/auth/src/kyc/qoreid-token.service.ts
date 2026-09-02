import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';

interface QoreIdTokenResponse {
  accessToken: string;
  expiresIn: string; // e.g. "7200 secs"
  tokenType: string;
}

// Shared client-credentials token (https://docs.qoreid.com/reference/get-client-token)
// for every QoreID-backed provider (BVN, NIN, ...) — QoreID tokens are valid
// for ~2 hours and are meant to be reused across calls, not fetched per
// request, so this is one cache shared by all providers rather than each
// provider keeping (and separately refreshing) its own.
@Injectable()
export class QoreIdTokenService {
  private readonly logger = new Logger(QoreIdTokenService.name);
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.accessToken;
    }

    const { clientId, secret, baseUrl } = this.configService.get('kyc.qoreid', {
      infer: true,
    });
    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured (missing QOREID_CLIENT_ID / QOREID_SECRET)',
      );
    }

    const response = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, secret }),
    });
    const body = (await response
      .json()
      .catch(() => null)) as QoreIdTokenResponse | null;

    if (!response.ok || !body?.accessToken) {
      this.logger.error(
        `QoreID token request failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'Failed to authenticate with identity verification provider',
      );
    }

    const ttlSeconds = parseInt(body.expiresIn, 10) || 7200;
    this.cachedToken = {
      accessToken: body.accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return body.accessToken;
  }
}
