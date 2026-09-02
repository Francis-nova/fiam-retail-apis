import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
} from '@app/common';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-notification-client.token';

// Fire-and-forget publish, same trade-off as PaymentProvisioningPublisher —
// a brief broker outage swallowing this emit silently is a known v1 gap (no
// transactional outbox); acceptable since postoffice is the only sender of
// real SMS/email/push now, and auth has no fallback path of its own.
@Injectable()
export class NotificationPublisher {
  constructor(
    @Inject(POSTOFFICE_NOTIFICATION_CLIENT)
    private readonly client: ClientProxy,
  ) {}

  requestSms(recipient: string, text: string): void {
    this.client.emit(NOTIFICATION_REQUESTED_PATTERN, {
      messageId: randomUUID(),
      channel: NotificationChannel.SMS,
      recipient,
      // No template renderer yet — postoffice sends `data.message` as-is.
      template: 'raw-text',
      data: { message: text },
      requestedAt: new Date().toISOString(),
    });
  }
}
