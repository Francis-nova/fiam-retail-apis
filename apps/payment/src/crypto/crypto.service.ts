import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { CurrencyCode } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { WalletsService } from '../wallets/wallets.service';
import { AddressService } from '../wallets/address.service';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { StableStackClient } from './stablestack.client';
import { StableStackCustomer } from './entities/stablestack-customer.entity';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';

type Stablecoin = CurrencyCode.USDC | CurrencyCode.USDT;

// shortcut: one network per coin, so one active address per wallet; allow
// several active addresses per wallet before adding a second network.
export const NETWORK_BY_COIN: Record<Stablecoin, string> = {
  [CurrencyCode.USDC]: 'polygon',
  [CurrencyCode.USDT]: 'trc20',
};

const AUTH_TIMEOUT_MS = 5_000;

// EVM addresses are case-insensitive (mixed case is only a checksum), so they
// are stored and matched in lower case. Tron addresses are case-sensitive.
export function normaliseAddress(address: string): string {
  return address.startsWith('0x') ? address.toLowerCase() : address;
}

// Webhook fields are untyped JSON: read text fields defensively.
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface CryptoWalletSummary {
  currency: Stablecoin;
  balance: string;
  network: string;
  address: string;
}

interface AuthUser {
  email: string;
  firstName: string;
  lastName: string;
  tier: string;
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);

  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
    private readonly client: StableStackClient,
    private readonly walletsService: WalletsService,
    private readonly addressService: AddressService,
    private readonly transactionsService: TransactionsService,
    private readonly dataSource: DataSource,
    @InjectRepository(StableStackCustomer)
    private readonly customers: Repository<StableStackCustomer>,
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
  ) {}

  // The customer taps Create wallet. Idempotent: a wallet that already has an
  // address is returned as is, so StableStack's limited address pool is only
  // drawn on once per user and coin.
  async createWallet(
    userId: string,
    dto: CreateCryptoWalletDto,
  ): Promise<CryptoWalletSummary> {
    const user = await this.lookupUser(userId);
    if (user.tier === 'TIER_1') {
      throw new ForbiddenException(
        'Upgrade your account to use stablecoin wallets.',
      );
    }

    // One create per user at a time (a double tap must not open two
    // StableStack wallets). A session lock, so each step below commits on
    // its own: a StableStack customer we created is never rolled back.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.query('SELECT pg_advisory_lock(hashtext($1))', [userId]);
    try {
      const wallet = await this.walletsService.getOrCreateWallet(
        userId,
        dto.currency,
      );
      const existing = await this.addressService.findActiveForWallet(wallet.id);
      if (existing) return this.summary(dto.currency, wallet.balance, existing);

      const customer = await this.getOrCreateCustomer(userId, user, dto);
      const created = await this.client.createWallet({
        customerId: customer.stablestackCustomerId,
        currency: dto.currency,
        network: NETWORK_BY_COIN[dto.currency],
      });
      const address = await this.addressService.insertActiveAddress(wallet.id, {
        provider: PaymentProviderKey.STABLESTACK,
        accountNumber: normaliseAddress(created.address),
        accountName: null,
        providerTierRaw: null,
        metadata: {
          network: created.network,
          stablestackWalletId: created.id,
        },
      });
      return this.summary(dto.currency, wallet.balance, address);
    } finally {
      await runner
        .query('SELECT pg_advisory_unlock(hashtext($1))', [userId])
        .catch(() => undefined);
      await runner.release();
    }
  }

  // NGN per 1 USD stablecoin as Fiam quotes it: StableStack's rate less our
  // markup. Used to show balances in naira.
  async ngnRate(): Promise<{ ngnPerUsd: string }> {
    const rate = await this.client.ngnRate();
    const markup = new Decimal(
      this.configService.get('stablestack.ngnMarkupPercent', { infer: true }),
    );
    return {
      ngnPerUsd: rate.times(new Decimal(100).minus(markup)).div(100).toFixed(2),
    };
  }

  // A verified StableStack webhook. Only completed deposits move money in
  // phase 1; everything is logged to webhook_events either way.
  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    const eventType = text(body.event_type) || 'unknown';
    await this.webhookEvents.save(
      this.webhookEvents.create({
        provider: PaymentProviderKey.STABLESTACK,
        eventType,
        reference: typeof body.id === 'string' ? body.id : null,
        payload: body,
        verified: true,
        verifiedAt: new Date(),
      }),
    );
    if (eventType !== 'wallet.transaction.inbound') return;

    const data = (body.data ?? {}) as Record<string, unknown>;
    const receiver = (data.receiver_wallet_details ?? {}) as Record<
      string,
      unknown
    >;
    const asset = text(data.asset_code).toUpperCase();
    const currency = [CurrencyCode.USDC, CurrencyCode.USDT].find(
      (c) => c.valueOf() === asset,
    );
    if (
      data.status !== 'COMPLETED' ||
      !currency ||
      typeof data.transaction_id !== 'string' ||
      typeof receiver.address !== 'string'
    ) {
      this.logger.warn(
        `StableStack inbound event ${text(body.id)} not credited (status ${text(data.status)}, asset ${asset})`,
      );
      return;
    }
    const amount = new Decimal(text(data.amount) || '0');
    if (!amount.isPositive()) return;

    await this.transactionsService.recordPayin({
      provider: PaymentProviderKey.STABLESTACK,
      currency,
      accountNumber: normaliseAddress(receiver.address),
      amount,
      reference: data.transaction_id,
      externalId:
        typeof data.crypto_transaction_id === 'string'
          ? data.crypto_transaction_id
          : null,
      narration: `${currency} deposit`,
      occurredAt:
        typeof data.created_at === 'string' ? new Date(data.created_at) : null,
      rawPayload: body,
    });
  }

  private async getOrCreateCustomer(
    userId: string,
    user: AuthUser,
    dto: CreateCryptoWalletDto,
  ): Promise<StableStackCustomer> {
    const existing = await this.customers.findOneBy({ userId });
    if (existing) return existing;
    if (!dto.compliance) {
      throw new BadRequestException(
        'Please answer the questions before creating your wallet.',
      );
    }
    const stablestackCustomerId = await this.client.createCustomer(user);
    return this.customers.save(
      this.customers.create({
        userId,
        stablestackCustomerId,
        compliance: dto.compliance,
      }),
    );
  }

  private summary(
    currency: Stablecoin,
    balance: string,
    address: { providerAccountNumber: string; providerMetadata: unknown },
  ): CryptoWalletSummary {
    const meta = (address.providerMetadata ?? {}) as { network?: string };
    return {
      currency,
      balance,
      network: meta.network ?? NETWORK_BY_COIN[currency],
      address: address.providerAccountNumber,
    };
  }

  // Name, email and tier live in apps/auth. Fails closed: no tier, no wallet.
  private async lookupUser(userId: string): Promise<AuthUser> {
    const { internalUrl, internalApiKey } = this.configService.get('auth', {
      infer: true,
    });
    try {
      const response = await fetch(
        `${internalUrl}/internal/users/${encodeURIComponent(userId)}/contact`,
        {
          headers: { 'x-internal-key': internalApiKey },
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const user = (await response.json()) as Partial<AuthUser>;
        if (user.email && user.firstName && user.lastName && user.tier) {
          return user as AuthUser;
        }
      }
      this.logger.error(`User lookup for ${userId} failed: ${response.status}`);
    } catch (err) {
      this.logger.error(`User lookup unreachable: ${(err as Error).message}`);
    }
    throw new ServiceUnavailableException(
      'Stablecoin wallets are unavailable right now. Please try again.',
    );
  }
}
