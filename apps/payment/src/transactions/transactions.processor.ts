import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { WalletsService } from '../wallets/wallets.service';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import {
  ProcessTransactionJobData,
  TRANSACTION_PROCESSING_QUEUE,
} from './transaction-processing.queue';

@Processor(TRANSACTION_PROCESSING_QUEUE)
export class TransactionsProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionsProcessor.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
  ) {
    super();
  }

  async process(job: Job<ProcessTransactionJobData>): Promise<void> {
    const { transactionId } = job.data;
    const transaction = await this.transactionsRepo.findOneBy({
      id: transactionId,
    });
    if (!transaction) {
      this.logger.error(
        `Transaction ${transactionId} not found — dropping job`,
      );
      return;
    }
    if (
      transaction.status === TransactionStatus.SUCCESSFUL ||
      transaction.status === TransactionStatus.FAILED
    ) {
      // Already terminal — a redelivered/duplicate job (e.g. the process
      // crashed after we committed but before BullMQ marked it complete)
      // is a safe no-op, not a re-credit.
      return;
    }

    if (transaction.type === TransactionType.DEBIT) {
      // Nothing in this codebase enqueues a DEBIT transaction yet (no
      // outbound-transfer feature exists) — fail loudly rather than
      // silently crediting the wrong direction if that assumption ever
      // breaks.
      throw new Error(
        `DEBIT transaction processing not implemented (transaction ${transactionId})`,
      );
    }

    await this.transactionsRepo.update(transactionId, {
      status: TransactionStatus.PROCESSING,
    });

    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.walletsService.creditForUpdate(
        manager,
        transaction.walletId as string,
        new Decimal(transaction.amount),
      );
      await manager.update(Transaction, transactionId, {
        status: TransactionStatus.SUCCESSFUL,
        balanceAfter: wallet.balance,
        verifiedAt: new Date(),
      });
    });
  }

  // BullMQ retries `process()` per the job's attempts/backoff (set at
  // enqueue time in TransactionsService) before giving up — this only
  // fires once retries are exhausted, which is the actual "this
  // transaction failed for good" signal.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessTransactionJobData> | undefined) {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }
    this.logger.error(
      `Transaction ${job.data.transactionId} failed permanently after ${job.attemptsMade} attempts`,
    );
    await this.transactionsRepo.update(job.data.transactionId, {
      status: TransactionStatus.FAILED,
      verifiedAt: new Date(),
    });
  }
}
