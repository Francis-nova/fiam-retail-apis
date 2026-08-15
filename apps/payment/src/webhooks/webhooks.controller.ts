import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentConfig } from '../config/configuration';
import { WebhooksService } from './webhooks.service';
import { VfdInwardCreditWebhookDto } from './dto/vfd-inward-credit-webhook.dto';

@Controller('webhooks/vfd')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  // VFD doesn't sign webhook payloads, so this shared secret (registered
  // with VFD out-of-band as part of the webhook URL) is our only protection
  // — a query param, since header support on VFD's sender isn't documented.
  // 401/400 are the only "retry might help" outcomes; everything else
  // (processed, duplicate, unmatched account) returns 200, since VFD
  // retrying wouldn't change the result.
  @Post('inward-credit')
  @HttpCode(HttpStatus.OK)
  async inwardCredit(
    @Query('secret') secret: string,
    @Body() dto: VfdInwardCreditWebhookDto,
  ) {
    const configured = this.configService.get('vfd.webhookSecret', {
      infer: true,
    });
    if (!configured) {
      throw new ServiceUnavailableException('VFD webhook is not configured');
    }
    if (secret !== configured) {
      throw new UnauthorizedException();
    }
    await this.webhooksService.handleVfdInwardCredit(dto);
    return { status: 'received' };
  }
}
