import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';
import {
  NinApplicant,
  NinProvider,
  NinVerificationResult,
} from './nin-provider.interface';
import { QoreIdTokenService } from './qoreid-token.service';

interface QoreIdNinResponse {
  status?: { state?: string; status?: string };
  summary?: {
    nin_check?: {
      status?: string;
      fieldMatches?: { firstname?: boolean; lastname?: boolean };
    };
  };
  nin?: {
    firstname?: string;
    lastname?: string;
    phone?: string;
    gender?: string;
    // Also present: middlename, birthdate ("DD-MM-YYYY"), photo
    // (base64), address — deliberately not surfaced here; this is a
    // name/identity match check, not a profile-import, and the base64
    // photo in particular is too heavy to carry through this response.
  };
}

// QoreID NIN identity verification — https://docs.qoreid.com/reference/nin-identity
@Injectable()
export class QoreIdNinProvider implements NinProvider {
  private readonly logger = new Logger(QoreIdNinProvider.name);

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
    private readonly tokenService: QoreIdTokenService,
  ) {}

  async verify(
    nin: string,
    applicant: NinApplicant,
  ): Promise<NinVerificationResult> {
    const { baseUrl } = this.configService.get('kyc.qoreid', { infer: true });
    const accessToken = await this.tokenService.getAccessToken();

    const response = await fetch(
      `${baseUrl}/v1/ng/identities/nin/${encodeURIComponent(nin)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          firstname: applicant.firstName,
          lastname: applicant.lastName,
          ...(applicant.dob ? { dob: applicant.dob } : {}),
        }),
      },
    );
    const body = (await response
      .json()
      .catch(() => null)) as QoreIdNinResponse | null;

    // Unlike BVN's bvn-basic endpoint, a nonexistent NIN comes back as a 404
    // ("NIN not found. Provide a valid NIN") rather than 400/422 — verified
    // live against the real API, not just documented.
    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 422
    ) {
      throw new BadRequestException('Invalid NIN');
    }
    if (!response.ok || !body) {
      this.logger.error(
        `QoreID NIN lookup failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Failed to verify NIN');
    }

    const ninFound = body.status?.status === 'verified';
    const fieldMatches = body.summary?.nin_check?.fieldMatches;
    const nameMatch = fieldMatches
      ? Boolean(fieldMatches.firstname) && Boolean(fieldMatches.lastname)
      : body.summary?.nin_check?.status === 'EXACT_MATCH';

    return {
      matched: ninFound && nameMatch,
      firstName: body.nin?.firstname ?? applicant.firstName,
      lastName: body.nin?.lastname ?? applicant.lastName,
      phone: body.nin?.phone ?? null,
      gender: body.nin?.gender ?? null,
    };
  }
}
