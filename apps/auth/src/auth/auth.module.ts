import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PendingLogin } from './entities/pending-login.entity';
import { UsersModule } from '../users/users.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { OtpModule } from '../otp/otp.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TokensModule } from '../tokens/tokens.module';
import { DevicesModule } from '../devices/devices.module';
import { SmsModule } from '../sms/sms.module';
import { KycModule } from '../kyc/kyc.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PendingLogin]),
    UsersModule,
    CredentialsModule,
    OtpModule,
    SessionsModule,
    TokensModule,
    DevicesModule,
    SmsModule,
    KycModule,
    MessagingModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
