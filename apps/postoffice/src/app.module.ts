import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { MessagingModule } from './messaging/messaging.module';
import { SmsModule } from './sms/sms.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/postoffice/.env',
      load: [configuration],
      validate,
    }),
    SmsModule,
    EmailModule,
    MessagingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
