import {
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { reportIssueToSlack, safeJson } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import {
  CreateCryptoWithdrawalDto,
  QuoteCryptoWithdrawalDto,
} from './dto/crypto-withdrawal.dto';
import {
  CreateConversionDto,
  QuoteConversionDto,
} from './dto/crypto-conversion.dto';
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

  // Fee breakdown before the customer confirms: StableStack's platform and
  // network fees, our fee, and what the recipient gets.
  @Get('withdrawals/quote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  quoteWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: QuoteCryptoWithdrawalDto,
  ) {
    return this.cryptoService.quoteWithdrawal(
      user.userId,
      q.currency,
      q.amount,
      q.address,
      q.network,
    );
  }

  @Post('withdrawals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCryptoWithdrawalDto,
  ) {
    return this.cryptoService.withdraw(user.userId, dto);
  }

  // Naira the customer gets for selling a coin amount, at Fiam's rate.
  @Get('conversions/quote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  quoteConversion(@Query() q: QuoteConversionDto) {
    return this.cryptoService.quoteConversion(q.currency, q.amount);
  }

  @Post('conversions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversionDto,
  ) {
    return this.cryptoService.convert(user.userId, dto);
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
  async receive(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const secret = this.configService.get('stablestack.webhookSecret', {
      infer: true,
    });
    if (!isValidStableStackSignature(body ?? {}, secret)) {
      // StableStack retries ~every 10 min with the original t, so once an
      // event is past the 5-min window it can only come back as a fresh event.
      const eventId = typeof body?.id === 'string' ? body.id : 'unknown';
      // Age tells a stale/replayed event (> 300s) apart from a wrong secret.
      const t = /^t=(\d+),/.exec(
        typeof body?.signature === 'string' ? body.signature : '',
      )?.[1];
      const ageSeconds = t
        ? Math.round((Date.now() - Number(t)) / 1000)
        : 'no signature';
      // Redacted headers/body for debugging. rawMatchesParsed=false means our
      // re-serialised body differs from the bytes they signed; true with a
      // fresh age means the secret is wrong.
      const rawMatchesParsed =
        req.rawBody?.toString('utf8') === JSON.stringify(body);
      this.logger.warn(
        `Rejected StableStack webhook ${eventId} (age ${ageSeconds}s, rawMatchesParsed=${rawMatchesParsed}) headers=${safeJson(headers)} body=${safeJson(body)}`,
      );
      reportIssueToSlack('StableStack webhook rejected: bad signature', {
        eventId,
        ageSeconds,
        secretSet: secret ? 'yes' : 'no',
      });
      throw new UnauthorizedException();
    }
    await this.cryptoService.handleWebhook(body);
    return { received: true };
  }
}
