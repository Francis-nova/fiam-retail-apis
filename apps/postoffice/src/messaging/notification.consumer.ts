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

@Controller()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
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
          // No template renderer yet — `data.message` is the raw text to
          // send. Real per-template copy lands with the mailer/push work.
          await this.smsProvider.send(message.recipient, message.data.message);
          break;
        default:
          this.logger.warn(
            `No handler yet for channel "${message.channel}" (template: ${message.template})`,
          );
      }
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error(
        `Notification delivery failed for ${message.recipient}: ${(err as Error).message}`,
      );
      // No requeue — a permanently-failing send (bad number, missing
      // provider creds) would otherwise loop forever. Routes to the queue's
      // dead-letter exchange for manual investigation instead.
      channel.nack(originalMsg, false, false);
    }
  }
}
