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
import { QoreIdTokenService } from './qoreid-token.service';

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
@Injectable()
export class QoreIdBvnProvider implements BvnProvider {
  private readonly logger = new Logger(QoreIdBvnProvider.name);

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
    private readonly tokenService: QoreIdTokenService,
  ) {}

  async verify(
    bvn: string,
    applicant: BvnApplicant,
  ): Promise<BvnVerificationResult> {
    const { baseUrl } = this.configService.get('kyc.qoreid', { infer: true });
    const accessToken = await this.tokenService.getAccessToken();

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
