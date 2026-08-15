import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { TokensService } from './tokens.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthConfig } from '../config/configuration';
import { Session } from '../sessions/entities/session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken, Session]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AuthConfig, true>) => ({
        secret: configService.get('jwt.accessSecret', { infer: true }),
        signOptions: {
          expiresIn: configService.get('jwt.accessTtl', { infer: true }),
        },
      }),
    }),
  ],
  providers: [TokensService, JwtStrategy],
  exports: [TokensService],
})
export class TokensModule {}
