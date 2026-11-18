import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import {
  CurrencyCode,
  reportIssueToSlack,
  withJobRequestId,
} from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { WalletsService } from '../wallets/wallets.service';
import { AddressService } from '../wallets/address.service';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import {
  StableStackClient,
  type StableStackTransaction,
} from './stablestack.client';
import { StableStackCustomer } from './entities/stablestack-customer.entity';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { CreateCryptoWithdrawalDto } from './dto/crypto-withdrawal.dto';
import {
  Transaction,
  TransactionKind,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { PayoutsService } from '../payouts/payouts.service';
import { PinVerifierService } from '../payouts/pin-verifier.service';
import { NotificationsService } from '../notifications/notifications.service';

export const CRYPTO_WITHDRAWAL_STATUS_QUEUE = 'crypto-withdrawal-status';
const SUCCESS_STATUSES = ['COMPLETED', 'COMPLETE', 'CONFIRMED', 'SUCCESSFUL'];
const FAILED_STATUSES = ['FAILED', 'CANCELLED', 'REVERSED'];

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

// Everything is in the coin. `amount` leaves the customer's wallet and every
// fee comes out of it, so the recipient gets `recipientReceives`.
export interface WithdrawalQuote {
  currency: Stablecoin;
  network: string;
  amount: string;
  platformFee: string;
  networkFee: string;
  fiamFee: string;
  totalFee: string;
  recipientReceives: string;
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
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly payoutsService: PayoutsService,
    private readonly pinVerifier: PinVerifierService,
    private readonly notifications: NotificationsService,
    @InjectQueue(CRYPTO_WITHDRAWAL_STATUS_QUEUE)
    private readonly statusQueue: Queue<{ transactionId: string }>,
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

  async quoteWithdrawal(
    userId: string,
    currency: Stablecoin,
    amount: string,
    address?: string,
  ): Promise<WithdrawalQuote> {
    const customer = await this.customerOrFail(userId);
    return this.quote(
      customer.stablestackCustomerId,
      currency,
      amount,
      address,
    );
  }

  // Send to an external address. The full amount is held as a PROCESSING
  // payout first, so a failure can be refunded the same way naira payouts are.
  async withdraw(
    userId: string,
    dto: CreateCryptoWithdrawalDto,
  ): Promise<Transaction> {
    const { transferLimit } = await this.pinVerifier.assertValid(
      userId,
      dto.pin,
    );
    const customer = await this.customerOrFail(userId);
    const wallet = await this.walletsService.findByUserAndCurrency(
      userId,
      dto.currency,
    );
    if (!wallet) throw new BadRequestException('Create this wallet first.');
    const address = normaliseAddress(dto.address);
    const q = await this.quote(
      customer.stablestackCustomerId,
      dto.currency,
      dto.amount,
      address,
    );

    // Naira value for the new-device cap, which is set in naira. Only fetched
    // while the cap applies, so a rate outage can't block other sends.
    const ngnValue = transferLimit
      ? new Decimal(q.amount)
          .times((await this.ngnRate()).ngnPerUsd)
          .toDecimalPlaces(2)
      : null;
    const ngnWallet = transferLimit
      ? await this.walletsService.findByUserAndCurrency(
          userId,
          CurrencyCode.NGN,
        )
      : null;

    // As a payout row: amount = what the recipient gets, fee = every charge,
    // so amount + fee is the debit and what a reversal refunds.
    const transaction = await this.dataSource.transaction(async (manager) => {
      const debited = await this.walletsService.debitForUpdate(
        manager,
        wallet.id,
        new Decimal(q.amount),
      );
      // After the wallet lock, like naira payouts.
      if (ngnValue) {
        await this.payoutsService.assertWithinTransferLimit(
          manager,
          userId,
          ngnWallet?.id ?? null,
          ngnValue,
          transferLimit,
        );
      }
      return manager.save(
        Transaction,
        manager.create(Transaction, {
          walletId: wallet.id,
          currency: dto.currency,
          type: TransactionType.DEBIT,
          kind: TransactionKind.PAYOUT,
          status: TransactionStatus.PROCESSING,
          provider: PaymentProviderKey.STABLESTACK,
          accountNumber: address,
          amount: q.recipientReceives,
          fee: q.totalFee,
          balanceAfter: debited.balance,
          // Replaced by StableStack's transaction_id once they accept it.
          reference: `FCW${randomUUID().replace(/-/g, '')}`,
          narration: `${dto.currency} sent on ${q.network}`,
          rawPayload: { quote: { ...q, ngnValue: ngnValue?.toFixed(2) } },
        }),
      );
    });

    let created: StableStackTransaction;
    try {
      created = await this.client.createWithdrawal({
        customerId: customer.stablestackCustomerId,
        currency: dto.currency,
        network: q.network,
        address,
        amount: new Decimal(q.amount),
        narration: transaction.reference,
      });
    } catch (err) {
      // A 4xx means StableStack refused it: nothing left the wallet.
      if (err instanceof BadRequestException) {
        await this.payoutsService.reverseFailedPayout(transaction.id);
        throw err;
      }
      // Timeout or 5xx: it may have been sent, so hold the funds for a person.
      reportIssueToSlack(
        'Crypto withdrawal outcome unknown — check StableStack',
        {
          reference: transaction.reference,
          transactionId: transaction.id,
        },
      );
      return transaction;
    }

    await this.transactions.update(transaction.id, {
      reference: created.transaction_id,
      providerStatusCode: created.status,
      rawPayload: { quote: q, created },
    });
    await this.statusQueue.add(
      'sync',
      withJobRequestId({ transactionId: transaction.id }),
      {
        delay: 5 * 60_000,
        attempts: 10,
        backoff: { type: 'exponential', delay: 5 * 60_000 },
      },
    );
    await this.applyWithdrawalStatus(transaction.id, created);
    return this.transactions.findOneByOrFail({ id: transaction.id });
  }

  // Used by the status job when no webhook has settled the withdrawal yet.
  async syncWithdrawal(
    transactionId: string,
  ): Promise<'DONE' | 'SUCCESSFUL' | 'FAILED' | 'UNRESOLVED'> {
    const transaction = await this.transactions.findOneBy({
      id: transactionId,
    });
    if (transaction?.status !== TransactionStatus.PROCESSING) return 'DONE';
    const data = await this.client.getTransaction(transaction.reference);
    return this.applyWithdrawalStatus(transactionId, data);
  }

  // Idempotent: only a PROCESSING withdrawal moves, so a webhook and the
  // status job can both report the same outcome safely.
  private async applyWithdrawalStatus(
    transactionId: string,
    data: { status?: unknown; crypto_transaction_id?: unknown },
  ): Promise<'SUCCESSFUL' | 'FAILED' | 'UNRESOLVED'> {
    const status = text(data.status).toUpperCase();
    if (FAILED_STATUSES.includes(status)) {
      await this.payoutsService.reverseFailedPayout(transactionId);
      return 'FAILED';
    }
    if (!SUCCESS_STATUSES.includes(status)) return 'UNRESOLVED';

    const transaction = await this.transactions.findOneBy({
      id: transactionId,
    });
    if (transaction?.status !== TransactionStatus.PROCESSING)
      return 'SUCCESSFUL';
    // The on-chain hash goes in rawPayload, not externalId: a send to another
    // Fiam wallet shares the hash with that deposit, and externalId is unique.
    const result = await this.transactions.update(
      { id: transactionId, status: TransactionStatus.PROCESSING },
      {
        status: TransactionStatus.SUCCESSFUL,
        providerStatusCode: status,
        verifiedAt: new Date(),
        rawPayload: {
          ...transaction.rawPayload,
          cryptoTransactionId: text(data.crypto_transaction_id) || null,
        } as never,
      },
    );
    if (result.affected) {
      void this.notifications.notifyTransaction(
        transaction,
        'PAYOUT_SUCCESSFUL',
      );
    }
    return 'SUCCESSFUL';
  }

  private async quote(
    customerId: string,
    currency: Stablecoin,
    amountRaw: string,
    address?: string,
  ): Promise<WithdrawalQuote> {
    const amount = new Decimal(amountRaw);
    if (!amount.isPositive()) {
      throw new BadRequestException('Enter an amount greater than zero.');
    }
    const network = NETWORK_BY_COIN[currency];
    if (address && !(await this.client.isValidAddress(currency, address))) {
      throw new BadRequestException(
        `That isn't a valid ${currency} address on ${network}.`,
      );
    }
    const fees = await this.client.withdrawalFees({
      customerId,
      currency,
      network,
      amount,
    });
    const total = fees.platform.plus(fees.network).plus(fees.fiam);
    const receives = amount.minus(total);
    if (!receives.isPositive()) {
      throw new BadRequestException(
        `The fees are ${total.toFixed(2)} ${currency}. Send more than that.`,
      );
    }
    return {
      currency,
      network,
      amount: amount.toFixed(8),
      platformFee: fees.platform.toFixed(8),
      networkFee: fees.network.toFixed(8),
      fiamFee: fees.fiam.toFixed(8),
      totalFee: total.toFixed(8),
      recipientReceives: receives.toFixed(8),
    };
  }

  private async customerOrFail(userId: string): Promise<StableStackCustomer> {
    const customer = await this.customers.findOneBy({ userId });
    if (!customer) throw new BadRequestException('Create a wallet first.');
    return customer;
  }

  // A verified StableStack webhook. Deposits credit, withdrawal outcomes
  // settle the payout; everything is logged to webhook_events either way.
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
    const data = (body.data ?? {}) as Record<string, unknown>;
    if (
      [
        'wallet.transaction.outbound',
        'payout.completed',
        'payout.failed',
        'payout.cancelled',
      ].includes(eventType)
    ) {
      const withdrawal = await this.transactions.findOneBy({
        provider: PaymentProviderKey.STABLESTACK,
        kind: TransactionKind.PAYOUT,
        reference: text(data.transaction_id),
      });
      // Can beat our own save of their transaction_id; the status job catches it.
      if (!withdrawal) return;
      const status =
        eventType === 'payout.completed'
          ? 'COMPLETED'
          : eventType === 'wallet.transaction.outbound'
            ? data.status
            : 'FAILED';
      await this.applyWithdrawalStatus(withdrawal.id, { ...data, status });
      return;
    }
    if (eventType !== 'wallet.transaction.inbound') return;

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
