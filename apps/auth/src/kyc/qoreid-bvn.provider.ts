import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';
import {
  BvnApplicant,
  BvnProvider,
  BvnVerificationResult,
} from './bvn-provider.interface';

interface QoreIdTokenResponse {
  accessToken: string;
  expiresIn: string; // e.g. "7200 secs"
  tokenType: string;
}

interface QoreIdBvnResponse {
  status?: { state?: string; status?: string };
  summary?: {
    bvn_check?: {
      status?: string;
      fieldMatches?: { firstname?: boolean; lastname?: boolean };
    };
  };
  bvn?: {
    firstname?: string;
    lastname?: string;
    birthdate?: string;
    gender?: string;
    phone?: string;
  };
}

// QoreID BVN verification — https://docs.qoreid.com/reference/bvn
// Auth is a cached client-credentials token (https://docs.qoreid.com/reference/get-client-token),
// not per-request — QoreID tokens are valid for ~2 hours.
@Injectable()
export class QoreIdBvnProvider implements BvnProvider {
  private readonly logger = new Logger(QoreIdBvnProvider.name);
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.accessToken;
    }

    const { clientId, secret, baseUrl } = this.configService.get('kyc.qoreid', {
      infer: true,
    });
    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        'BVN verification is not configured (missing QOREID_CLIENT_ID / QOREID_SECRET)',
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
        'Failed to authenticate with BVN provider',
      );
    }

    const ttlSeconds = parseInt(body.expiresIn, 10) || 7200;
    this.cachedToken = {
      accessToken: body.accessToken,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return body.accessToken;
  }

  async verify(
    bvn: string,
    applicant: BvnApplicant,
  ): Promise<BvnVerificationResult> {
    const { baseUrl } = this.configService.get('kyc.qoreid', { infer: true });
    const accessToken = await this.getAccessToken();

    const response = await fetch(
      `${baseUrl}/v1/ng/identities/bvn-basic/${encodeURIComponent(bvn)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          firstname: applicant.firstName,
          lastname: applicant.lastName,
        }),
      },
    );
    const body = (await response
      .json()
      .catch(() => null)) as QoreIdBvnResponse | null;

    if (response.status === 400 || response.status === 422) {
      throw new BadRequestException('Invalid BVN');
    }
    if (!response.ok || !body) {
      this.logger.error(
        `QoreID BVN lookup failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Failed to verify BVN');
    }

    const bvnFound = body.status?.status === 'verified';
    const fieldMatches = body.summary?.bvn_check?.fieldMatches;
    const nameMatch = fieldMatches
      ? Boolean(fieldMatches.firstname) && Boolean(fieldMatches.lastname)
      : body.summary?.bvn_check?.status === 'EXACT_MATCH';

    return {
      matched: bvnFound && nameMatch,
      firstName: body.bvn?.firstname ?? applicant.firstName,
      lastName: body.bvn?.lastname ?? applicant.lastName,
      phone: body.bvn?.phone ?? null,
      dob: body.bvn?.birthdate ?? null,
      gender: body.bvn?.gender ?? null,
    };
  }
}
