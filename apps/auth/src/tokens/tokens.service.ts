import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuthConfig } from '../config/configuration';
import {
  addDuration,
  generateRefreshToken,
  hashRefreshToken,
} from './token.util';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Matches the "expires in 30 minutes" copy on the reset-password screen.
const PASSWORD_RESET_TOKEN_TTL = '30m';

@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AuthConfig, true>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepo: Repository<PasswordResetToken>,
  ) {}

  async issueTokenPair(userId: string, sessionId: string): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync({
      sub: userId,
      sid: sessionId,
    });
    const refreshToken = generateRefreshToken();
    const refreshTtl = this.configService.get('jwt.refreshTtl', {
      infer: true,
    });

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId,
        sessionId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: addDuration(new Date(), refreshTtl),
      }),
    );

    return { accessToken, refreshToken };
  }

  async rotateRefreshToken(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = hashRefreshToken(rawRefreshToken);

    // Unlocked pre-check, deliberately outside any transaction: if this
    // token was already rotated away, the revoke below must commit even
    // though the request itself is about to fail. Doing it inside the same
    // transaction we then throw out of would roll the revoke back too —
    // silently undoing the theft response while still reporting success to
    // the caller. (Found by testing the reuse path, not by inspection.)
    const existing = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (existing.revokedAt) {
      // Reuse of an already-rotated token signals theft — kill the whole session.
      await this.refreshTokenRepo.update(
        { sessionId: existing.sessionId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      // Row lock + re-check: closes the race between the unlocked check
      // above and this point, where a concurrent rotation (or reuse
      // detection) of the same token could have landed in between.
      const locked = await repo.findOne({
        where: { id: existing.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.revokedAt) {
        throw new UnauthorizedException('Refresh token reuse detected');
      }

      const accessToken = await this.jwtService.signAsync({
        sub: locked.userId,
        sid: locked.sessionId,
      });
      const rawNewRefreshToken = generateRefreshToken();
      const refreshTtl = this.configService.get('jwt.refreshTtl', {
        infer: true,
      });

      const newToken = await repo.save(
        repo.create({
          userId: locked.userId,
          sessionId: locked.sessionId,
          tokenHash: hashRefreshToken(rawNewRefreshToken),
          expiresAt: addDuration(new Date(), refreshTtl),
        }),
      );
      await repo.update(locked.id, {
        revokedAt: new Date(),
        replacedByTokenId: newToken.id,
      });

      return { accessToken, refreshToken: rawNewRefreshToken };
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { sessionId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllRefreshTokensForUserExcept(
    userId: string,
    exceptSessionId: string,
  ): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, revokedAt: IsNull(), sessionId: Not(exceptSessionId) },
      { revokedAt: new Date() },
    );
  }

  async issuePasswordResetToken(userId: string): Promise<string> {
    const token = generateRefreshToken();
    await this.passwordResetTokenRepo.save(
      this.passwordResetTokenRepo.create({
        userId,
        tokenHash: hashRefreshToken(token),
        expiresAt: addDuration(new Date(), PASSWORD_RESET_TOKEN_TTL),
      }),
    );
    return token;
  }

  // Single-use: the token is marked consumed in the same call that
  // validates it, so a second attempt with the same token — replay,
  // double-submit, whatever — fails even within its 30-minute window.
  async consumePasswordResetToken(rawToken: string): Promise<string> {
    const tokenHash = hashRefreshToken(rawToken);
    const record = await this.passwordResetTokenRepo.findOne({
      where: { tokenHash },
    });

    if (
      !record ||
      record.consumedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    await this.passwordResetTokenRepo.update(record.id, {
      consumedAt: new Date(),
    });
    return record.userId;
  }
}
