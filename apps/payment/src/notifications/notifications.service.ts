import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
  PushTemplate,
  withRequestId,
} from '@app/common';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';
import { PaymentConfig } from '../config/configuration';
import { WalletsService } from '../wallets/wallets.service';
import { Transaction } from '../transactions/entities/transaction.entity';
import { formatTokenForDisplay } from '../providers/vfd/vfd-bill-token';
import { BILL_CUSTOMER_LABEL, BILL_TYPE_LABEL } from '../bills/bill-labels';
import { BillType } from '../transactions/entities/transaction.entity';
import { PaymentSlackNotifier } from '../slack/payment-slack.notifier';
import type {
  AlertableTransaction,
  PaymentOutcome,
} from '../slack/slack-messages';

export type TransactionNotificationEvent =
  | 'CREDIT_RECEIVED'
  | 'PAYOUT_SUCCESSFUL'
  | 'PAYOUT_FAILED'
  // Staff-posted wallet adjustments (admin console manual postings).
  | 'ACCOUNT_CREDITED'
  | 'ACCOUNT_DEBITED';

const TEMPLATE_BY_EVENT: Record<TransactionNotificationEvent, PushTemplate> = {
  CREDIT_RECEIVED: PushTemplate.MONEY_RECEIVED,
  PAYOUT_SUCCESSFUL: PushTemplate.PAYOUT_SUCCESSFUL,
  PAYOUT_FAILED: PushTemplate.PAYOUT_FAILED,
  ACCOUNT_CREDITED: PushTemplate.ACCOUNT_CREDITED,
  ACCOUNT_DEBITED: PushTemplate.ACCOUNT_DEBITED,
};

// Postoffice's email template for a money-in / money-out receipt. Only the
// two successful events get one — a failed payout is push-only for now.
// What each notification event means for the payments Slack feed.
const OUTCOME_BY_EVENT: Record<TransactionNotificationEvent, PaymentOutcome> = {
  CREDIT_RECEIVED: 'SUCCESSFUL',
  PAYOUT_SUCCESSFUL: 'SUCCESSFUL',
  PAYOUT_FAILED: 'FAILED',
  ACCOUNT_CREDITED: 'SUCCESSFUL',
  ACCOUNT_DEBITED: 'SUCCESSFUL',
};

const RECEIPT_TEMPLATE = 'transaction-receipt';
// Bill payments (airtime, data, electricity…) have their own receipt.
const BILL_RECEIPT_TEMPLATE = 'bill-receipt';
const RECEIPT_DIRECTION: Partial<
  Record<TransactionNotificationEvent, 'credit' | 'debit'>
> = {
  CREDIT_RECEIVED: 'credit',
  PAYOUT_SUCCESSFUL: 'debit',
  ACCOUNT_CREDITED: 'credit',
  ACCOUNT_DEBITED: 'debit',
};

// Adjustments aren't transfers: the receipt shows the description instead of
// a sender/recipient, and uses adjustment wording.
const ADJUSTMENT_EVENTS = new Set<TransactionNotificationEvent>([
  'ACCOUNT_CREDITED',
  'ACCOUNT_DEBITED',
]);

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
      | 'bill'
      | 'billType'
      | 'fee'
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
    private readonly slack: PaymentSlackNotifier,
  ) {}

  // The payments Slack feed for a transaction that didn't go through
  // notifyTransaction (e.g. a deposit that could not be credited). Safe to call
  // without awaiting.
  async alertTransaction(
    transaction: AlertableTransaction & { walletId?: string | null },
    outcome: PaymentOutcome,
  ): Promise<void> {
    try {
      const wallet = transaction.walletId
        ? await this.walletsService.findById(transaction.walletId)
        : null;
      this.slack.transaction(transaction, outcome, wallet?.userId);
    } catch (err) {
      this.logger.warn(
        `Could not post payment alert: ${(err as Error).message}`,
      );
    }
  }

  // Safe to call without awaiting.
  async notifyTransaction(
    transaction: NotifiableTransaction | null,
    event: TransactionNotificationEvent,
    // receiptEmail: false holds the email back (bills whose token isn't known
    // yet send it later through sendBillReceiptEmail). Push and Slack are
    // unaffected.
    options: { receiptEmail?: boolean } = {},
  ): Promise<void> {
    try {
      if (!transaction?.walletId) return;
      const wallet = await this.walletsService.findById(transaction.walletId);
      if (!wallet) return;

      // Same moment, same facts: the payments Slack feed. (The objects passed
      // here are full transactions; the parameter type is just narrow.)
      this.slack.transaction(
        transaction,
        OUTCOME_BY_EVENT[event],
        wallet.userId,
      );

      this.client.emit(
        NOTIFICATION_REQUESTED_PATTERN,
        withRequestId({
          messageId: randomUUID(),
          channel: NotificationChannel.PUSH,
          // For push, the recipient is the customer's user id — the mobile app
          // registers each device under it.
          recipient: wallet.userId,
          template: TEMPLATE_BY_EVENT[event],
          data: { amount: transaction.amount, transactionId: transaction.id },
          requestedAt: new Date().toISOString(),
        }),
      );

      // Independent of the push above: an email problem never affects it.
      if (options.receiptEmail !== false) {
        await this.sendReceiptEmail(transaction, wallet.userId, event);
      }
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
    // A bill is not a bank transfer: it has its own receipt, with the biller,
    // what was bought and, where there is one, the token.
    if (transaction.bill) {
      await this.emitBillReceipt(transaction, userId);
      return;
    }
    try {
      const contact = await this.lookupContact(userId);
      if (!contact) return;

      const adjustment = ADJUSTMENT_EVENTS.has(event);
      const counterparty =
        direction === 'credit' || adjustment
          ? (transaction.narration ?? 'Bank transfer')
          : (transaction.beneficiary?.accountName ??
            transaction.accountNumber ??
            'Bank transfer');
      const occurred =
        transaction.occurredAt ?? transaction.createdAt ?? new Date();

      this.client.emit(
        NOTIFICATION_REQUESTED_PATTERN,
        withRequestId({
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
            ...(adjustment ? { adjustment: 'true' } : {}),
            occurredAt: lagosDate(new Date(occurred)),
          },
          requestedAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Could not queue receipt email for ${transaction.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The receipt email for a bill payment, sent on its own (the token turned up
   * after the payment, or never did: `tokenMissing`). Safe to await; failures
   * are logged, not thrown.
   */
  async sendBillReceiptEmail(
    transaction: NotifiableTransaction,
    options: { tokenMissing?: boolean } = {},
  ): Promise<void> {
    try {
      if (!transaction.walletId) return;
      const wallet = await this.walletsService.findById(transaction.walletId);
      if (!wallet) return;
      await this.emitBillReceipt(transaction, wallet.userId, options);
    } catch (err) {
      this.logger.warn(
        `Could not send bill receipt for ${transaction.id}: ${(err as Error).message}`,
      );
    }
  }

  private async emitBillReceipt(
    transaction: NotifiableTransaction,
    userId: string,
    options: { tokenMissing?: boolean } = {},
  ): Promise<void> {
    try {
      const bill = transaction.bill;
      if (!bill) return;
      const contact = await this.lookupContact(userId);
      if (!contact) return;

      const type = transaction.billType ?? BillType.OTHER;
      const amount = new Decimal(transaction.amount);
      const fee = new Decimal(transaction.fee ?? 0);
      const occurred =
        transaction.occurredAt ?? transaction.createdAt ?? new Date();
      const extras = (bill.extraTokens ?? []).slice(0, 2);

      const data: Record<string, string> = {
        name: contact.firstName,
        firstName: contact.firstName,
        billType: type,
        billTypeLabel: BILL_TYPE_LABEL[type],
        customerLabel: BILL_CUSTOMER_LABEL[type],
        biller: bill.billerName,
        plan: bill.paymentItemName,
        paidFor: bill.customerId,
        amount: naira(amount.toString()),
        total: naira(amount.plus(fee).toString()),
        reference: transaction.reference ?? transaction.id,
        status: 'Successful',
        occurredAt: lagosDate(new Date(occurred)),
      };
      if (fee.greaterThan(0)) data.fee = naira(fee.toString());
      if (bill.token) {
        data.hasToken = 'true';
        data.token = formatTokenForDisplay(bill.token);
      } else if (options.tokenMissing) {
        data.tokenMissing = 'true';
      }
      extras.forEach((extra, i) => {
        data[`extra${i + 1}Label`] = extra.label;
        data[`extra${i + 1}`] = formatTokenForDisplay(extra.value);
      });

      this.client.emit(
        NOTIFICATION_REQUESTED_PATTERN,
        withRequestId({
          messageId: randomUUID(),
          channel: NotificationChannel.EMAIL,
          recipient: contact.email,
          template: BILL_RECEIPT_TEMPLATE,
          data,
          requestedAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Could not queue bill receipt email for ${transaction.id}: ${(err as Error).message}`,
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
