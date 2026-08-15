import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { AddressService } from '../wallets/address.service';
import { WalletsService } from '../wallets/wallets.service';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import {
  PROCESS_TRANSACTION_JOB,
  ProcessTransactionJobData,
  TRANSACTION_PROCESSING_QUEUE,
} from './transaction-processing.queue';

export interface RecordPayinInput {
  provider: PaymentProviderKey;
  currency: CurrencyCode;
  accountNumber: string;
  amountMinor: bigint;
  reference: string;
  externalId?: string | null;
  narration?: string | null;
  occurredAt?: Date | null;
  rawPayload?: Record<string, unknown> | null;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly addressService: AddressService,
    private readonly walletsService: WalletsService,
    @InjectQueue(TRANSACTION_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessTransactionJobData>,
  ) {}

  // Entry point for any inbound-payment event (currently just VFD's inward-
  // credit webhook, via WebhooksService). Idempotent on (provider,
  // reference) — a redelivered event is a clean no-op, returns null.
  // Resolves the wallet eagerly (a fast DB read) so PENDING vs UNMATCHED is
  // decided immediately; the actual balance mutation is deferred to the
  // BullMQ worker so a slow/failed credit never blocks the webhook response.
  async recordPayin(input: RecordPayinInput): Promise<Transaction | null> {
    const address = await this.addressService.findActiveByProviderAccountNumber(
      input.provider,
      input.accountNumber,
    );
    const wallet = address
      ? await this.walletsService.findById(address.walletId)
      : null;

    const insertResult = await this.transactionsRepo
      .createQueryBuilder()
      .insert()
      .into(Transaction)
      .values({
        walletId: wallet?.id ?? null,
        currency: input.currency,
        type: TransactionType.CREDIT,
        status: wallet
          ? TransactionStatus.PENDING
          : TransactionStatus.UNMATCHED,
        provider: input.provider,
        accountNumber: input.accountNumber,
        amountMinor: input.amountMinor.toString(),
        reference: input.reference,
        externalId: input.externalId ?? null,
        narration: input.narration ?? null,
        occurredAt: input.occurredAt ?? null,
        verifiedAt: wallet ? null : new Date(),
        // Cast: TypeORM's QueryDeepPartialEntity mapped type doesn't play
        // well with a nullable jsonb column typed as Record<string, unknown>.
        rawPayload: (input.rawPayload ?? null) as never,
      })
      .orIgnore()
      .returning('id')
      .execute();

    const transactionId = insertResult.identifiers[0]?.id as string | undefined;
    if (!transactionId) {
      this.logger.log(
        `Duplicate ${input.provider} payin ignored: ${input.reference}`,
      );
      return null;
    }

    if (!wallet) {
      this.logger.error(
        `${input.provider} payin for unmatched account_number "${input.accountNumber}" (reference ${input.reference}) — flagged for manual reconciliation`,
      );
      return this.transactionsRepo.findOneByOrFail({ id: transactionId });
    }

    await this.queue.add(
      PROCESS_TRANSACTION_JOB,
      { transactionId },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    );

    return this.transactionsRepo.findOneByOrFail({ id: transactionId });
  }

  // Most-recent-first across every wallet the user owns (currently just
  // one, NGN — see WalletsService.findAllForUser). Ordered by createdAt,
  // not occurredAt/verifiedAt: occurredAt is only ever set for CREDIT
  // (from VFD's webhook timestamp) and stays null for DEBIT/payout rows,
  // so it can't be a reliable universal sort key.
  async findAllForUser(userId: string, limit: number): Promise<Transaction[]> {
    const wallets = await this.walletsService.findAllForUser(userId);
    if (wallets.length === 0) {
      return [];
    }
    return this.transactionsRepo.find({
      where: { walletId: In(wallets.map((wallet) => wallet.id)) },
      relations: ['beneficiary'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // Ownership isn't a column on Transaction itself (only walletId is) — so
  // this is a lookup-then-check rather than a single scoped query. A
  // transaction with no walletId (UNMATCHED payin) or one belonging to a
  // different user's wallet both come back as "not found", not 403 —
  // deliberately not distinguishing "doesn't exist" from "not yours".
  async findOneForUser(userId: string, id: string): Promise<Transaction> {
    const transaction = await this.transactionsRepo.findOne({
      where: { id },
      relations: ['beneficiary'],
    });
    if (!transaction || !transaction.walletId) {
      throw new NotFoundException('Transaction not found');
    }
    const wallet = await this.walletsService.findById(transaction.walletId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }
}
