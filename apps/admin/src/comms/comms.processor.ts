import { Inject, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ClientProxy } from '@nestjs/microservices';
import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
  PushTemplate,
  withRequestId,
} from '@app/common';
import { POSTOFFICE_NOTIFICATION_CLIENT } from '../audit/postoffice-client.token';
import { AUTH_DB } from '../database/readonly-database.module';
import { Broadcast, BroadcastStatus } from './entities/broadcast.entity';

export const BROADCAST_QUEUE = 'admin-broadcasts';
const BATCH = 500;

interface Recipient {
  id: string;
  email: string | null;
  first_name: string | null;
}

// Fans a broadcast out to postoffice one message per customer per channel.
// Pages through customers by id so "all" never loads the whole table.
@Processor(BROADCAST_QUEUE)
export class CommsProcessor extends WorkerHost {
  private readonly logger = new Logger(CommsProcessor.name);

  constructor(
    @InjectRepository(Broadcast) private readonly repo: Repository<Broadcast>,
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
    @Inject(POSTOFFICE_NOTIFICATION_CLIENT)
    private readonly client: ClientProxy,
  ) {
    super();
  }

  // shortcut: no retries (attempts=1) because a re-run would re-send to
  // customers already published; add a resume cursor before enabling retries.
  async process(job: Job<{ broadcastId: string }>): Promise<void> {
    const b = await this.repo.findOneByOrFail({ id: job.data.broadcastId });
    await this.repo.update(b.id, { status: BroadcastStatus.PROCESSING });
    try {
      let after = '00000000-0000-0000-0000-000000000000';
      let recipients = 0;
      let published = 0;
      for (;;) {
        const rows: Recipient[] = await this.auth.query(
          `SELECT id, email, first_name FROM users
           WHERE status = 'ACTIVE' AND id > $1
             AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
           ORDER BY id LIMIT ${BATCH}`,
          [after, b.customerIds],
        );
        if (rows.length === 0) break;
        for (const u of rows) {
          recipients++;
          published += this.publish(b, u);
        }
        after = rows[rows.length - 1].id;
        await this.repo.update(b.id, {
          recipientCount: recipients,
          publishedCount: published,
        });
      }
      await this.repo.update(b.id, {
        status: BroadcastStatus.COMPLETED,
        completedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`Broadcast ${b.id} failed: ${String(err)}`);
      await this.repo.update(b.id, {
        status: BroadcastStatus.FAILED,
        error: String(err).slice(0, 500),
        completedAt: new Date(),
      });
    }
  }

  private publish(b: Broadcast, u: Recipient): number {
    let n = 0;
    const emit = (
      channel: NotificationChannel,
      recipient: string,
      template: string,
      data: Record<string, string>,
    ) => {
      this.client.emit(
        NOTIFICATION_REQUESTED_PATTERN,
        withRequestId({
          messageId: `${b.id}:${u.id}:${channel}`,
          channel,
          recipient,
          template,
          data,
          requestedAt: new Date().toISOString(),
        }),
      );
      n++;
    };
    if (b.channels.includes('push')) {
      emit(NotificationChannel.PUSH, u.id, PushTemplate.BROADCAST, {
        title: b.title,
        body: b.body,
      });
    }
    if (b.channels.includes('email') && u.email) {
      const firstName = u.first_name || 'there';
      emit(NotificationChannel.EMAIL, u.email, 'broadcast', {
        title: b.title,
        body: b.body,
        firstName,
        name: firstName,
      });
    }
    return n;
  }
}
