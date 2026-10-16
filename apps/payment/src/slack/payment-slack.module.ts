import { Module } from '@nestjs/common';
import { PaymentSlackNotifier } from './payment-slack.notifier';

@Module({
  providers: [PaymentSlackNotifier],
  exports: [PaymentSlackNotifier],
})
export class PaymentSlackModule {}
