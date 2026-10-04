import { SkipThrottle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConfig } from '../config/configuration';
import { WebhooksService } from './webhooks.service';
import { VFD_AUTH_HEADER, isValidVfdAuthHeader } from './vfd-auth-header';
import { VfdInwardCreditWebhookDto } from './dto/vfd-inward-credit-webhook.dto';

// Authenticated by x-auth-token and sent by VFD (bursty, shared IPs).
@SkipThrottle()
@Controller('webhooks/vfd')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  // VFD doesn't sign webhook payloads; it sends a pre-agreed
  // `x-auth-token: vfd <token>` header, which is our only protection. It's a
  // header (not a URL param) so it never lands in proxy access logs.
  // 401/400 are the only "retry might help" outcomes; everything else
  // (processed, duplicate, unmatched account) returns 200, since VFD
  // retrying wouldn't change the result.
  @Post('inward-credit')
  @HttpCode(HttpStatus.OK)
  async inwardCredit(
    @Headers(VFD_AUTH_HEADER) authHeader: string | undefined,
    @Body() dto: VfdInwardCreditWebhookDto,
  ) {
    const configured = this.configService.get('vfd.webhookAuthToken', {
      infer: true,
    });
    if (!configured) {
      throw new ServiceUnavailableException('VFD webhook is not configured');
    }
    if (!isValidVfdAuthHeader(authHeader, configured)) {
      throw new UnauthorizedException();
    }
    await this.webhooksService.handleVfdInwardCredit(dto);
    return { status: 'received' };
  }
}
