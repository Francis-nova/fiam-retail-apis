import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import {
  Transaction,
  TransactionStatus,
} from '../transactions/entities/transaction.entity';
import { PayoutsService } from './payouts.service';
import {
  PAYOUT_STATUS_QUERY_QUEUE,
  PayoutStatusQueryJobData,
} from './payout-status-query.queue';

@Processor(PAYOUT_STATUS_QUERY_QUEUE)
export class PayoutStatusQueryProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutStatusQueryProcessor.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
    private readonly payoutsService: PayoutsService,
  ) {
    super();
  }

  async process(job: Job<PayoutStatusQueryJobData>): Promise<void> {
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
      // Already terminal — a redelivered/duplicate job is a safe no-op.
      return;
    }

    const provider = this.registry.getProviderByKey(transaction.provider);
    const result = await provider.queryTransferStatus(transaction.reference);

    await this.transactionsRepo.update(transactionId, {
      externalId: result.externalId ?? transaction.externalId,
      providerStatusCode: result.providerStatusCode,
      // Cast: same QueryDeepPartialEntity/jsonb workaround as
      // TransactionsService.recordPayin.
      rawPayload: (result.rawPayload ?? transaction.rawPayload) as never,
    });

    if (result.outcome === 'SUCCESSFUL') {
      await this.transactionsRepo.update(transactionId, {
        status: TransactionStatus.SUCCESSFUL,
        verifiedAt: new Date(),
      });
      return;
    }
    if (result.outcome === 'FAILED') {
      await this.payoutsService.reverseFailedPayout(transactionId);
      return;
    }

    // Still unresolved — throw to trigger BullMQ's own attempts/backoff
    // retry (configured at enqueue time in PayoutsService).
    throw new Error(
      `Payout ${transaction.reference} still unresolved (status ${result.providerStatusCode ?? 'unknown'})`,
    );
  }

  // Only fires once BullMQ's own retries are exhausted — per VFD's "Quick
  // Guide" a payout pending beyond ~24h should be escalated to support, not
  // guessed at, so this deliberately leaves the transaction PROCESSING
  // rather than marking it FAILED (we still don't actually know).
  @OnWorkerEvent('failed')
  onFailed(job: Job<PayoutStatusQueryJobData> | undefined) {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }
    this.logger.error(
      `Payout status query exhausted retries for transaction ${job.data.transactionId} — needs manual reconciliation via VFD support`,
    );
  }
}
