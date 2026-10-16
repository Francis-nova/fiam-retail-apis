import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  POOL_BALANCE_JOB,
  POOL_BALANCE_QUEUE,
  POOL_BALANCE_SCHEDULER_ID,
} from './pool-balance.queue';

// Registers the hourly job. BullMQ keeps the schedule in Redis under a fixed
// id, so several replicas (or a restart) re-register the same one instead of
// each running its own: exactly one report per hour.
@Injectable()
export class PoolBalanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(PoolBalanceScheduler.name);

  constructor(@InjectQueue(POOL_BALANCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        POOL_BALANCE_SCHEDULER_ID,
        // On the hour, Lagos time.
        { pattern: '0 * * * *', tz: 'Africa/Lagos' },
        {
          name: POOL_BALANCE_JOB,
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 24,
            removeOnFail: 24,
          },
        },
      );
    } catch (err) {
      // Redis trouble at boot must not stop the service from starting.
      this.logger.error(
        `Could not schedule the pool balance report: ${(err as Error).message}`,
      );
    }
  }
}
