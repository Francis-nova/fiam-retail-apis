import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
  PushTemplate,
} from '@app/common';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';
import { WalletsService } from '../wallets/wallets.service';
import { Transaction } from '../transactions/entities/transaction.entity';

export type TransactionNotificationEvent =
  'CREDIT_RECEIVED' | 'PAYOUT_SUCCESSFUL' | 'PAYOUT_FAILED';

const TEMPLATE_BY_EVENT: Record<TransactionNotificationEvent, PushTemplate> = {
  CREDIT_RECEIVED: PushTemplate.MONEY_RECEIVED,
  PAYOUT_SUCCESSFUL: PushTemplate.PAYOUT_SUCCESSFUL,
  PAYOUT_FAILED: PushTemplate.PAYOUT_FAILED,
};

// Asks postoffice (which owns all delivery — email, SMS and push) to notify
// the owner of a transaction. This only publishes a message to its queue;
// rendering the copy and talking to the push provider happen there.
//
// Strictly best-effort and fire-and-forget: a failure here is logged and
// swallowed, so a notification can never fail or roll back a money movement.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(POSTOFFICE_NOTIFICATION_CLIENT)
    private readonly client: ClientProxy,
    private readonly walletsService: WalletsService,
  ) {}

  // Safe to call without awaiting.
  async notifyTransaction(
    transaction: Pick<Transaction, 'id' | 'walletId' | 'amount'> | null,
    event: TransactionNotificationEvent,
  ): Promise<void> {
    try {
      if (!transaction?.walletId) return;
      const wallet = await this.walletsService.findById(transaction.walletId);
      if (!wallet) return;

      this.client.emit(NOTIFICATION_REQUESTED_PATTERN, {
        messageId: randomUUID(),
        channel: NotificationChannel.PUSH,
        // For push, the recipient is the customer's user id — the mobile app
        // registers each device under it.
        recipient: wallet.userId,
        template: TEMPLATE_BY_EVENT[event],
        data: { amount: transaction.amount, transactionId: transaction.id },
        requestedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Could not queue ${event} notification for ${transaction?.id}: ${(err as Error).message}`,
      );
    }
  }
}
