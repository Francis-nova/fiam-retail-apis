import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthConfig } from '../config/configuration';
import {
  QOREID_SIGNATURE_HEADER,
  isValidQoreIdSignature,
} from './qoreid-signature';

// Called by QoreID (bursty, shared IPs) and authenticated by its HMAC
// signature, not by the IP rate limit.
@SkipThrottle()
@Controller('webhooks/qoreid')
export class QoreIdWebhookController {
  private readonly logger = new Logger(QoreIdWebhookController.name);

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  // Nothing in the app depends on QoreID calling back (NIN/BVN verification
  // is request/response and the liveness result comes through the SDK), so this
  // endpoint only authenticates the call and records that it happened. QoreID's
  // test ping is an empty `{}` body; that must succeed. The payload carries
  // personal data, so only the event name/status are logged, never the body.
  @Post()
  @HttpCode(HttpStatus.OK)
  handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers(QOREID_SIGNATURE_HEADER) signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = this.configService.get('kyc.qoreid.webhookSecret', {
      infer: true,
    });
    if (!secret) {
      throw new ServiceUnavailableException('QoreID webhook is not configured');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    if (!isValidQoreIdSignature(signature, req.rawBody, secret)) {
      throw new UnauthorizedException();
    }

    const event = typeof body?.event === 'string' ? body.event : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;
    this.logger.log(
      `QoreID webhook received${event ? ` event=${event}` : ' (empty/test ping)'}${
        status ? ` status=${status}` : ''
      }`,
    );
    return { status: 'received' };
  }
}
