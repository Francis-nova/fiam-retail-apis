import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
  PushTemplate,
} from '@app/common';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';
import { PaymentConfig } from '../config/configuration';
import { WalletsService } from '../wallets/wallets.service';
import { Transaction } from '../transactions/entities/transaction.entity';

export type TransactionNotificationEvent =
  'CREDIT_RECEIVED' | 'PAYOUT_SUCCESSFUL' | 'PAYOUT_FAILED';

const TEMPLATE_BY_EVENT: Record<TransactionNotificationEvent, PushTemplate> = {
  CREDIT_RECEIVED: PushTemplate.MONEY_RECEIVED,
  PAYOUT_SUCCESSFUL: PushTemplate.PAYOUT_SUCCESSFUL,
  PAYOUT_FAILED: PushTemplate.PAYOUT_FAILED,
};

// Postoffice's email template for a money-in / money-out receipt. Only the
// two successful events get one — a failed payout is push-only for now.
const RECEIPT_TEMPLATE = 'transaction-receipt';
const RECEIPT_DIRECTION: Partial<
  Record<TransactionNotificationEvent, 'credit' | 'debit'>
> = {
  CREDIT_RECEIVED: 'credit',
  PAYOUT_SUCCESSFUL: 'debit',
};

const AUTH_LOOKUP_TIMEOUT_MS = 5_000;

type NotifiableTransaction = Pick<Transaction, 'id' | 'walletId' | 'amount'> &
  Partial<
    Pick<
      Transaction,
      | 'reference'
      | 'narration'
      | 'accountNumber'
      | 'occurredAt'
      | 'createdAt'
      | 'beneficiary'
    >
  >;

function naira(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return '₦0.00';
  return `₦${value.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function lagosDate(date: Date): string {
  return date.toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

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
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  // Safe to call without awaiting.
  async notifyTransaction(
    transaction: NotifiableTransaction | null,
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

      // Independent of the push above: an email problem never affects it.
      await this.sendReceiptEmail(transaction, wallet.userId, event);
    } catch (err) {
      this.logger.warn(
        `Could not queue ${event} notification for ${transaction?.id}: ${(err as Error).message}`,
      );
    }
  }

  private async sendReceiptEmail(
    transaction: NotifiableTransaction,
    userId: string,
    event: TransactionNotificationEvent,
  ): Promise<void> {
    const direction = RECEIPT_DIRECTION[event];
    if (!direction) return;
    try {
      const contact = await this.lookupContact(userId);
      if (!contact) return;

      const counterparty =
        direction === 'credit'
          ? (transaction.narration ?? 'Bank transfer')
          : (transaction.beneficiary?.accountName ??
            transaction.accountNumber ??
            'Bank transfer');
      const occurred =
        transaction.occurredAt ?? transaction.createdAt ?? new Date();

      this.client.emit(NOTIFICATION_REQUESTED_PATTERN, {
        messageId: randomUUID(),
        channel: NotificationChannel.EMAIL,
        recipient: contact.email,
        template: RECEIPT_TEMPLATE,
        data: {
          name: contact.firstName,
          firstName: contact.firstName,
          direction,
          amount: naira(transaction.amount),
          counterparty,
          reference: transaction.reference ?? transaction.id,
          status: 'Successful',
          occurredAt: lagosDate(new Date(occurred)),
        },
        requestedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Could not queue receipt email for ${transaction.id}: ${(err as Error).message}`,
      );
    }
  }

  // The customer's email lives in apps/auth, not here — ask it over its
  // internal (shared-secret) endpoint. Returns null (email skipped) rather
  // than throwing if auth is unconfigured or unreachable.
  private async lookupContact(
    userId: string,
  ): Promise<{ email: string; firstName: string } | null> {
    const { internalUrl, internalApiKey } = this.configService.get('auth', {
      infer: true,
    });
    if (!internalApiKey) {
      this.logger.warn('INTERNAL_API_KEY is not set — skipping receipt email');
      return null;
    }
    const response = await fetch(
      `${internalUrl}/internal/users/${encodeURIComponent(userId)}/contact`,
      {
        headers: { 'x-internal-key': internalApiKey },
        signal: AbortSignal.timeout(AUTH_LOOKUP_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      this.logger.warn(
        `Auth contact lookup for ${userId} failed: ${response.status}`,
      );
      return null;
    }
    const body = (await response.json()) as {
      email?: string;
      firstName?: string;
    };
    if (!body.email) return null;
    return { email: body.email, firstName: body.firstName ?? '' };
  }
}
