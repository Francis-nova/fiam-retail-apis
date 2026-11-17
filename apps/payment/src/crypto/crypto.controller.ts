import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { reportIssueToSlack } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { isValidStableStackSignature } from './stablestack-signature';

@Controller('crypto')
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  @Post('wallets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCryptoWalletDto,
  ) {
    return this.cryptoService.createWallet(user.userId, dto);
  }

  @Get('rate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  rate() {
    return this.cryptoService.ngnRate();
  }
}

// Sent by StableStack, authenticated by the HMAC `signature` in the body.
@SkipThrottle()
@Controller('webhooks/stablestack')
export class StableStackWebhookController {
  private readonly logger = new Logger(StableStackWebhookController.name);

  constructor(
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  // No DTO on purpose: the signature covers the body exactly as sent, so
  // validation must not strip or reshape it first.
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: Record<string, unknown>) {
    const secret = this.configService.get('stablestack.webhookSecret', {
      infer: true,
    });
    if (!isValidStableStackSignature(body ?? {}, secret)) {
      // StableStack never retries a 4xx: this event is lost unless it is
      // replayed from their dashboard, so someone has to hear about it.
      const eventId = typeof body?.id === 'string' ? body.id : 'unknown';
      this.logger.warn(`Rejected StableStack webhook ${eventId}`);
      reportIssueToSlack('StableStack webhook rejected: bad signature', {
        eventId,
      });
      throw new UnauthorizedException();
    }
    await this.cryptoService.handleWebhook(body);
    return { received: true };
  }
}
