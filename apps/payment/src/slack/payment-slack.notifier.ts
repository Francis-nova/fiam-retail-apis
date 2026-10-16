import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { environmentLabel, postToSlack } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import {
  AlertableTransaction,
  PaymentOutcome,
  PoolBalanceReport,
  poolBalanceMessage,
  transactionMessage,
} from './slack-messages';

// The payment service's Slack feeds. Fire-and-forget and best effort: nothing
// here may fail, slow or roll back a money movement.
@Injectable()
export class PaymentSlackNotifier {
  constructor(private readonly config: ConfigService<PaymentConfig, true>) {}

  transaction(
    tx: AlertableTransaction,
    outcome: PaymentOutcome,
    userId?: string | null,
  ): void {
    try {
      const url = this.config.get('slack.paymentsWebhookUrl', { infer: true });
      if (!url) return;
      postToSlack(
        url,
        transactionMessage(tx, outcome, {
          environment: environmentLabel(),
          userId,
        }),
      );
    } catch {
      // never throw into the payment flow
    }
  }

  poolBalance(report: Omit<PoolBalanceReport, 'environment' | 'at'>): void {
    const url = this.config.get('slack.poolBalanceWebhookUrl', { infer: true });
    postToSlack(
      url,
      poolBalanceMessage({
        ...report,
        environment: environmentLabel(),
        at: new Date(),
      }),
    );
  }

  get poolReportEnabled(): boolean {
    return !!this.config.get('slack.poolBalanceWebhookUrl', { infer: true });
  }
}
