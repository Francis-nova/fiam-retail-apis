import { Module } from '@nestjs/common';
import { SmsModule } from '../sms/sms.module';
import { NotificationConsumer } from './notification.consumer';

@Module({
  imports: [SmsModule],
  controllers: [NotificationConsumer],
})
export class MessagingModule {}
