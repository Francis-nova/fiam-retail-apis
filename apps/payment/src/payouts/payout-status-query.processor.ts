import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PayoutsService } from './payouts.service';
import {
  PAYOUT_STATUS_QUERY_QUEUE,
  PayoutStatusQueryJobData,
} from './payout-status-query.queue';

@Processor(PAYOUT_STATUS_QUERY_QUEUE)
export class PayoutStatusQueryProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutStatusQueryProcessor.name);

  constructor(private readonly payoutsService: PayoutsService) {
    super();
  }

  async process(job: Job<PayoutStatusQueryJobData>): Promise<void> {
    const { transactionId } = job.data;
    const outcome = await this.payoutsService.syncPayoutStatus(transactionId);
    if (outcome === 'NOT_FOUND') {
      this.logger.error(
        `Transaction ${transactionId} not found — dropping job`,
      );
      return;
    }
    if (outcome === 'UNRESOLVED') {
      // Still unresolved — throw to trigger BullMQ's own attempts/backoff
      // retry (configured at enqueue time in PayoutsService).
      throw new Error(`Payout ${transactionId} still unresolved`);
    }
    // ALREADY_FINAL (a redelivered/duplicate job), SUCCESSFUL, FAILED and HOLD
    // are all terminal for polling: no retry.
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
