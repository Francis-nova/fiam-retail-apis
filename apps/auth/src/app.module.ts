import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { CredentialsModule } from './credentials/credentials.module';
import { TokensModule } from './tokens/tokens.module';
import { OtpModule } from './otp/otp.module';
import { SessionsModule } from './sessions/sessions.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/auth/.env',
      load: [configuration],
      validate,
    }),
    DatabaseModule,
    UsersModule,
    CredentialsModule,
    TokensModule,
    OtpModule,
    SessionsModule,
    AuthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
