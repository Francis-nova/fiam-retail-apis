import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Session } from '../sessions/entities/session.entity';
import { RefreshToken } from '../tokens/entities/refresh-token.entity';
import { PasswordResetToken } from '../tokens/entities/password-reset-token.entity';
import { Otp } from '../otp/entities/otp.entity';
import { TrustedDevice } from '../devices/entities/trusted-device.entity';
import { PendingLogin } from '../auth/entities/pending-login.entity';
import { KycDocument } from '../kyc/entities/kyc-document.entity';
import { AuthConfig } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AuthConfig, true>) => ({
        type: 'postgres',
        url: configService.get('database.url', { infer: true }),
        entities: [
          User,
          Session,
          RefreshToken,
          PasswordResetToken,
          Otp,
          TrustedDevice,
          PendingLogin,
          KycDocument,
        ],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
