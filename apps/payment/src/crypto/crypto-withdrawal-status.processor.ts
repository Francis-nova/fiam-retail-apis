import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { reportIssueToSlack, runWithJobRequestId } from '@app/common';
import {
  CRYPTO_WITHDRAWAL_STATUS_QUEUE,
  CryptoService,
} from './crypto.service';

// Safety net for a withdrawal whose webhook never arrived: asks StableStack
// where it stands until it is final.
@Processor(CRYPTO_WITHDRAWAL_STATUS_QUEUE)
export class CryptoWithdrawalStatusProcessor extends WorkerHost {
  private readonly logger = new Logger(CryptoWithdrawalStatusProcessor.name);

  constructor(private readonly cryptoService: CryptoService) {
    super();
  }

  process(
    job: Job<{ transactionId: string; requestId?: string }>,
  ): Promise<void> {
    return runWithJobRequestId(job, async () => {
      const outcome = await this.cryptoService.syncWithdrawal(
        job.data.transactionId,
      );
      // Throwing hands the retry to BullMQ's attempts/backoff.
      if (outcome === 'UNRESOLVED') {
        throw new Error(`Withdrawal ${job.data.transactionId} still pending`);
      }
    });
  }

  @OnWorkerEvent('failed')
  onFailed(
    job: Job<{ transactionId: string; requestId?: string }> | undefined,
  ) {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    this.logger.error(
      `Crypto withdrawal ${job.data.transactionId} still pending after every check`,
    );
    reportIssueToSlack('Crypto withdrawal still pending — check StableStack', {
      transactionId: job.data.transactionId,
    });
  }
}
