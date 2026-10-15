import { Logger } from '@nestjs/common';
import { runWithJobRequestId } from '@app/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BillsService } from './bills.service';
import {
  BILL_STATUS_QUERY_QUEUE,
  BillStatusQueryJobData,
} from './bill-status-query.queue';

@Processor(BILL_STATUS_QUERY_QUEUE)
export class BillStatusQueryProcessor extends WorkerHost {
  private readonly logger = new Logger(BillStatusQueryProcessor.name);

  constructor(private readonly billsService: BillsService) {
    super();
  }

  process(job: Job<BillStatusQueryJobData>): Promise<void> {
    return runWithJobRequestId(job, () => this.run(job));
  }

  private async run(job: Job<BillStatusQueryJobData>): Promise<void> {
    const { transactionId } = job.data;
    const outcome = await this.billsService.syncBillStatus(transactionId);
    if (outcome === 'NOT_FOUND') {
      this.logger.error(
        `Bill transaction ${transactionId} not found — dropping job`,
      );
      return;
    }
    if (outcome === 'UNRESOLVED') {
      // Throw so BullMQ's attempts/backoff (set at enqueue time) retries.
      throw new Error(`Bill payment ${transactionId} still unresolved`);
    }
  }

  // Only once retries are exhausted: leave the transaction PROCESSING for
  // manual reconciliation rather than guessing an outcome.
  @OnWorkerEvent('failed')
  onFailed(job: Job<BillStatusQueryJobData> | undefined) {
    if (!job) return;
    return runWithJobRequestId(job, () => {
      if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
      this.logger.error(
        `Bill status query exhausted retries for transaction ${job.data.transactionId} — needs manual reconciliation via VFD support`,
      );
    });
  }
}
