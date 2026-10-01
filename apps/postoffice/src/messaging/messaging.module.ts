import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { PushModule } from '../push/push.module';
import { NotificationConsumer } from './notification.consumer';

@Module({
  imports: [SmsModule, EmailModule, PushModule],
  controllers: [NotificationConsumer],
})
export class MessagingModule {}
