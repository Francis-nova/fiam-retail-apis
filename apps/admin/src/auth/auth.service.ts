import { randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, Repository } from 'typeorm';
import { sha256 } from '@app/common';
import { AdminConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { StaffStatus, StaffUser } from '../staff/entities/staff-user.entity';
import { StaffRefreshToken } from './entities/staff-refresh-token.entity';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
    @InjectRepository(StaffRefreshToken)
    private readonly refreshRepo: Repository<StaffRefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AdminConfig, true>,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip: string | null) {
    const staff = await this.staffRepo.findOne({
      where: { email: email.trim().toLowerCase() },
    });

    // Same response for unknown email / wrong password / disabled so the
    // endpoint can't be used to enumerate staff accounts.
    const invalid = new UnauthorizedException('Invalid email or password');

    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      await this.audit.recordSafe({
        staffEmail: email,
        action: 'auth.login_failed',
        ip,
        metadata: { reason: staff ? 'disabled' : 'unknown_email' },
      });
      throw invalid;
    }

    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      throw new HttpException(
        'Account temporarily locked after repeated failed sign-ins. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await argon2.verify(staff.passwordHash, password);
    if (!ok) {
      const attempts = staff.failedLoginAttempts + 1;
      const lock = attempts >= MAX_FAILED_ATTEMPTS;
      await this.staffRepo.update(staff.id, {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock
          ? new Date(Date.now() + LOCK_MINUTES * 60_000)
          : staff.lockedUntil,
      });
      await this.audit.recordSafe({
        staffId: staff.id,
        staffEmail: staff.email,
        action: lock ? 'auth.account_locked' : 'auth.login_failed',
        ip,
      });
      throw invalid;
    }

    await this.staffRepo.update(staff.id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action: 'auth.login',
      ip,
    });
    return this.issueTokens(staff, randomUUID());
  }

  async refresh(rawToken: string) {
    const existing = await this.refreshRepo.findOne({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!existing) throw new UnauthorizedException();

    if (existing.revokedAt) {
      // Reuse of a rotated token — revoke the whole family.
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException();
    }
    if (existing.expiresAt < new Date()) throw new UnauthorizedException();

    const staff = await this.staffRepo.findOne({
      where: { id: existing.staffId },
    });
    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    await this.refreshRepo.update(existing.id, { revokedAt: new Date() });
    return this.issueTokens(staff, existing.familyId);
  }

  async logout(rawToken: string) {
    const existing = await this.refreshRepo.findOne({
      where: { tokenHash: sha256(rawToken) },
    });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  async changePassword(
    staffId: string,
    currentPassword: string,
    newPassword: string,
    ip: string | null,
  ) {
    const staff = await this.staffRepo.findOneByOrFail({ id: staffId });
    if (!(await argon2.verify(staff.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'New password must differ from the current one',
      );
    }
    await this.staffRepo.update(staff.id, {
      passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
      mustChangePassword: false,
    });
    // Sign out every other session.
    await this.refreshRepo.update(
      { staffId: staff.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action: 'auth.password_changed',
      ip,
    });
    return this.issueTokens(
      { ...staff, mustChangePassword: false },
      randomUUID(),
    );
  }

  private async revokeFamily(familyId: string) {
    await this.refreshRepo.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async issueTokens(staff: StaffUser, familyId: string) {
    const accessToken = await this.jwt.signAsync({ sub: staff.id });
    const refreshToken = randomBytes(48).toString('base64url');
    const { refreshTtlDays } = this.config.get('jwt', { infer: true });
    await this.refreshRepo.insert({
      staffId: staff.id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + refreshTtlDays * 86_400_000),
    });
    return {
      accessToken,
      refreshToken,
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        email: staff.email,
        role: staff.role,
        mustChangePassword: staff.mustChangePassword,
      },
    };
  }
}
