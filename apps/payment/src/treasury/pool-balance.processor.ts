import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { reportIssueToSlack } from '@app/common';
import { POOL_BALANCE_QUEUE } from './pool-balance.queue';
import { PoolBalanceService } from './pool-balance.service';
import { PaymentSlackNotifier } from '../slack/payment-slack.notifier';

@Processor(POOL_BALANCE_QUEUE)
export class PoolBalanceProcessor extends WorkerHost {
  private readonly logger = new Logger(PoolBalanceProcessor.name);

  constructor(
    private readonly pool: PoolBalanceService,
    private readonly slack: PaymentSlackNotifier,
  ) {
    super();
  }

  async process(): Promise<void> {
    // Feed not configured: nothing to do (and no VFD call).
    if (!this.slack.poolReportEnabled) return;
    await this.pool.report();
  }

  // After the retries are used up: say so, rather than silently skipping an
  // hour and leaving the channel looking like everything is fine.
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error) {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    this.logger.error(`Pool balance report failed: ${err.message}`);
    reportIssueToSlack('Hourly pool balance report failed', {
      reason: err.message,
      attempts: job.attemptsMade,
    });
  }
}
