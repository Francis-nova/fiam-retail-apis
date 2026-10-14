import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';
import { safeJson } from '@app/common';

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
//
// QoreID product entitlements are per-project, and we run two: the main one
// (BVN) and the liveness one (`liveness_nin` sessions *and* the NIN lookup that
// double-checks them — the main project gets 403 "Forbidden resource" there).
// Each project gets its own cached token; 'liveness' falls back to the main
// pair when no separate liveness credentials are configured.
export type QoreIdProject = 'main' | 'liveness';

@Injectable()
export class QoreIdTokenService {
  private readonly logger = new Logger(QoreIdTokenService.name);
  private readonly cachedTokens = new Map<
    QoreIdProject,
    { accessToken: string; expiresAt: number }
  >();

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  async getAccessToken(project: QoreIdProject = 'main'): Promise<string> {
    const cached = this.cachedTokens.get(project);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.accessToken;
    }

    const qoreid = this.configService.get('kyc.qoreid', { infer: true });
    const { baseUrl } = qoreid;
    const clientId =
      project === 'liveness'
        ? qoreid.livenessClientId || qoreid.clientId
        : qoreid.clientId;
    const secret =
      project === 'liveness'
        ? qoreid.livenessSecret || qoreid.secret
        : qoreid.secret;
    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        project === 'liveness'
          ? 'Identity verification is not configured (missing QOREID_LIVENESS_CLIENT_ID / QOREID_LIVENESS_SECRET)'
          : 'Identity verification is not configured (missing QOREID_CLIENT_ID / QOREID_SECRET)',
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
        `QoreID token request failed (${project}): ${response.status} ${safeJson(body)}`,
      );
      throw new ServiceUnavailableException(
        'Failed to authenticate with identity verification provider',
      );
    }

    const ttlSeconds = parseInt(body.expiresIn, 10) || 7200;
    this.cachedTokens.set(project, {
      accessToken: body.accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return body.accessToken;
  }
}
