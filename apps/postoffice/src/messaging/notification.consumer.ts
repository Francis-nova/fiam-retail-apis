import { Controller, Inject, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
} from '@app/common';
import type { NotificationRequestedMessage } from '@app/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { EMAIL_PROVIDER } from '../email/email-provider.interface';
import type { EmailProvider } from '../email/email-provider.interface';
import { PUSH_PROVIDER } from '../push/push-provider.interface';
import type { PushProvider } from '../push/push-provider.interface';
import { isPushTemplate, renderPush } from '../push/push-templates';
import { TemplateRendererService } from '../email/template-renderer.service';
import { isEmailTemplate, subjectFor } from '../email/email-templates';

@Controller()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
    private readonly templateRenderer: TemplateRendererService,
  ) {}

  @EventPattern(NOTIFICATION_REQUESTED_PATTERN)
  async handle(
    @Payload() message: NotificationRequestedMessage,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as ConsumeMessage;

    try {
      switch (message.channel) {
        case NotificationChannel.SMS:
          // No template renderer for SMS yet — `data.message` is the raw
          // text to send. Real per-template copy lands with the push work.
          await this.smsProvider.send(message.recipient, message.data.message);
          break;
        case NotificationChannel.EMAIL:
          await this.sendEmail(message);
          break;
        case NotificationChannel.PUSH:
          await this.sendPush(message);
          break;
        default:
          this.logger.warn(
            `No handler yet for channel "${String(message.channel)}" (template: ${message.template})`,
          );
      }
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error(
        `Notification delivery failed for ${message.channel} recipient [REDACTED]: ${(err as Error).message}`,
      );
      // No requeue — a permanently-failing send (bad address, missing
      // provider creds) would otherwise loop forever. Routes to the queue's
      // dead-letter exchange for manual investigation instead.
      channel.nack(originalMsg, false, false);
    }
  }

  private async sendPush(message: NotificationRequestedMessage): Promise<void> {
    if (!isPushTemplate(message.template)) {
      throw new Error(`Unknown push template: ${message.template}`);
    }
    await this.pushProvider.send(
      message.recipient,
      renderPush(message.template, message.data),
    );
  }

  private async sendEmail(
    message: NotificationRequestedMessage,
  ): Promise<void> {
    if (!isEmailTemplate(message.template)) {
      throw new Error(`Unknown email template: ${message.template}`);
    }
    const html = this.templateRenderer.render(message.template, message.data);
    await this.emailProvider.send({
      to: message.recipient,
      toName: message.data.name,
      subject: subjectFor(message.template, message.data),
      html,
    });
  }
}
