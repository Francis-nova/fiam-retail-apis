import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';

interface SlackUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

// Posts business events to Slack, one incoming webhook (= one channel) per
// event type. Fire-and-forget: a Slack outage or bad URL is logged and
// swallowed so it can never fail or slow the customer's request. PII is kept
// to name + email; never BVN/NIN/phone.
@Injectable()
export class SlackNotifier {
  private readonly logger = new Logger(SlackNotifier.name);

  constructor(private readonly config: ConfigService<AuthConfig, true>) {}

  signedUp(user: SlackUser): void {
    this.post(
      this.config.get('slack.signupsWebhookUrl', { infer: true }),
      ':wave: New customer signed up',
      user,
    );
  }

  kycCompleted(user: SlackUser): void {
    this.post(
      this.config.get('slack.kycCompletedWebhookUrl', { infer: true }),
      ':white_check_mark: Customer completed KYC (BVN verified, PIN set)',
      user,
    );
  }

  tierUpgradeRequested(user: SlackUser): void {
    this.post(
      this.config.get('slack.tierUpgradesWebhookUrl', { infer: true }),
      ':arrow_up: Tier 3 upgrade requested, awaiting review',
      user,
    );
  }

  private post(url: string, headline: string, user: SlackUser): void {
    if (!url) {
      return;
    }
    const text = `${headline}\n*${user.firstName} ${user.lastName}* · ${user.email}\nUser ID: ${user.id}`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.warn(`Slack webhook responded ${res.status}`);
        }
      })
      .catch((err: Error) => {
        this.logger.warn(`Slack webhook failed: ${err.message}`);
      });
  }
}
