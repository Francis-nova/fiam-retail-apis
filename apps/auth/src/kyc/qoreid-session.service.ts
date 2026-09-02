import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';

interface QoreIdSessionResponse {
  sessionId: string;
  sdkSessionToken: string;
}

// Verified live: an outbound fetch here can genuinely hang indefinitely
// (observed a real "TypeError: fetch failed" only surfacing after 10+
// seconds against a long-lived dev process, while a fresh process reached
// the same QoreID endpoint in under a second) — without a timeout, that
// hang propagates all the way to the mobile app as a stuck spinner instead
// of a timely, recoverable error.
const QOREID_FETCH_TIMEOUT_MS = 15_000;

// QoreID SDK session tokens — https://docs.qoreid.com/reference/mint-a-session-token
// Separate from QoreIdTokenService's cached Bearer token: this endpoint is
// authenticated per-request with Basic auth (base64(clientId:secret)), not
// a cacheable client-credentials token, and each call mints a short-lived,
// single-use, product-scoped token meant to be handed to a *client-side*
// SDK — never reused across sessions the way the Bearer token is.
//
// Confirmed live against this account's real credentials that `liveness_nin`
// is the specific product actually subscribed (plain `liveness` and
// `face_verification_nin` both 403 "Not subscribed to this product" —
// account entitlements are genuinely per-product, not all-or-nothing).
@Injectable()
export class QoreIdSessionService {
  private readonly logger = new Logger(QoreIdSessionService.name);

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  async createSession(
    productCode: string,
    reference: string,
  ): Promise<QoreIdSessionResponse> {
    const { clientId, secret, baseUrl } = this.configService.get('kyc.qoreid', {
      infer: true,
    });
    if (!clientId || !secret) {
      throw new ServiceUnavailableException(
        'Identity verification is not configured (missing QOREID_CLIENT_ID / QOREID_SECRET)',
      );
    }
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basic}`,
        },
        body: JSON.stringify({ type: 'collection', productCode, reference }),
        signal: AbortSignal.timeout(QOREID_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `QoreID session creation network error for product ${productCode}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Failed to start identity verification session',
      );
    }
    const body = (await response
      .json()
      .catch(() => null)) as QoreIdSessionResponse | null;

    if (!response.ok || !body?.sdkSessionToken) {
      this.logger.error(
        `QoreID session creation failed for product ${productCode}: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'Failed to start identity verification session',
      );
    }
    return body;
  }
}
