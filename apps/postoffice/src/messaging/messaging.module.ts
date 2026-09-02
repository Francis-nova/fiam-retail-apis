import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { EmailModule } from '../email/email.module';
import { NotificationConsumer } from './notification.consumer';

@Module({
  imports: [SmsModule, EmailModule],
  controllers: [NotificationConsumer],
})
export class MessagingModule {}
