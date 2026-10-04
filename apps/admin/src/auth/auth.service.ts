import { createHmac, randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { TotpService } from './totp.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MFA_TOKEN_TTL = '5m';

type MfaStep = 'verify' | 'enroll';

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
    private readonly totp: TotpService,
  ) {}

  // --- Attempt limiting -----------------------------------------------------

  /**
   * Counts one sign-in attempt (password or second factor) with a single
   * atomic UPDATE *before* the secret is checked, so a burst of parallel
   * guesses can't all pass a stale "not locked" read: after
   * MAX_FAILED_ATTEMPTS the row is locked and later attempts are refused
   * without being evaluated.
   */
  private async reserveAttempt(
    staffId: string,
  ): Promise<{ allowed: boolean; justLocked: boolean }> {
    const expired = `(locked_until IS NOT NULL AND locked_until <= now())`;
    const next = `(CASE WHEN ${expired} THEN 1 ELSE failed_login_attempts + 1 END)`;
    const result: unknown = await this.staffRepo.query(
      `UPDATE staff_users SET
         failed_login_attempts = ${next},
         locked_until = CASE WHEN ${next} >= $2
                             THEN now() + make_interval(mins => $3)
                             ELSE NULL END
       WHERE id = $1 AND (locked_until IS NULL OR ${expired})
       RETURNING locked_until IS NOT NULL AS locked`,
      [staffId, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
    );
    const rows = Array.isArray(result) ? (result[0] as unknown) : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { allowed: false, justLocked: false };
    }
    return {
      allowed: true,
      justLocked: (rows[0] as { locked?: boolean }).locked === true,
    };
  }

  private resetAttempts(staffId: string) {
    return this.staffRepo.update(staffId, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  private lockedError() {
    return new HttpException(
      'Account temporarily locked after repeated failed sign-ins. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // --- Sign-in --------------------------------------------------------------

  /**
   * Step 1: email + password. Returns tokens when no second factor applies,
   * otherwise `{ mfa: 'verify' | 'enroll', mfaToken }` — a short-lived token
   * that is good only for the 2FA endpoints, never as an access token.
   */
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

    const attempt = await this.reserveAttempt(staff.id);
    if (!attempt.allowed) throw this.lockedError();

    const ok = await argon2.verify(staff.passwordHash, password);
    if (!ok) {
      await this.audit.recordSafe({
        staffId: staff.id,
        staffEmail: staff.email,
        action: attempt.justLocked
          ? 'auth.account_locked'
          : 'auth.login_failed',
        ip,
      });
      throw invalid;
    }

    const step = this.requiredMfaStep(staff);
    if (step) {
      // The counter is deliberately NOT reset here: a correct password must
      // not refresh the budget for guessing the second factor.
      return { mfa: step, mfaToken: await this.signMfaToken(staff.id, step) };
    }
    return this.completeLogin(staff, ip, 'password');
  }

  private requiredMfaStep(staff: StaffUser): MfaStep | null {
    if (staff.totpEnabledAt) return 'verify';
    if (this.config.get('totp', { infer: true }).required) return 'enroll';
    return null;
  }

  private async completeLogin(
    staff: StaffUser,
    ip: string | null,
    method: 'password' | 'totp' | 'recovery' | 'enrolment',
  ) {
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
      metadata: { method },
    });
    return this.issueTokens(staff, randomUUID());
  }

  // Signed with a secret derived from (but different to) the access secret, so
  // an MFA token can never validate as an access token.
  private mfaSecret(): string {
    return createHmac(
      'sha256',
      this.config.get('jwt.accessSecret', { infer: true }),
    )
      .update('admin-mfa-token')
      .digest('hex');
  }

  private signMfaToken(staffId: string, step: MfaStep) {
    return this.jwt.signAsync(
      { sub: staffId, step },
      { secret: this.mfaSecret(), expiresIn: MFA_TOKEN_TTL },
    );
  }

  private async readMfaToken(token: string, expected: MfaStep) {
    let payload: { sub: string; step: MfaStep };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.mfaSecret() });
    } catch {
      throw new UnauthorizedException('Sign-in expired — please start again');
    }
    if (payload.step !== expected) {
      throw new UnauthorizedException('Sign-in expired — please start again');
    }
    const staff = await this.staffRepo.findOne({ where: { id: payload.sub } });
    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      throw new UnauthorizedException('Sign-in expired — please start again');
    }
    return staff;
  }

  // --- Second factor: verify ------------------------------------------------

  /** Step 2 for an enrolled account: authenticator code or recovery code. */
  async verifyMfa(mfaToken: string, code: string, ip: string | null) {
    const staff = await this.readMfaToken(mfaToken, 'verify');
    if (!staff.totpEnabledAt || !staff.totpSecretEnc) {
      throw new UnauthorizedException('Sign-in expired — please start again');
    }

    const attempt = await this.reserveAttempt(staff.id);
    if (!attempt.allowed) throw this.lockedError();

    const method = await this.checkSecondFactor(staff, code);
    if (!method) {
      await this.audit.recordSafe({
        staffId: staff.id,
        staffEmail: staff.email,
        action: attempt.justLocked ? 'auth.account_locked' : 'auth.mfa_failed',
        ip,
      });
      throw new UnauthorizedException('Invalid code');
    }
    return this.completeLogin(staff, ip, method);
  }

  // Returns how the code was accepted, or null. Each accepted code is spent:
  // a TOTP time step can't repeat and a recovery code works once — both
  // enforced by atomic UPDATEs so two parallel requests can't both win.
  private async checkSecondFactor(
    staff: StaffUser,
    rawCode: string,
  ): Promise<'totp' | 'recovery' | null> {
    const code = rawCode.trim();
    if (/^\d{6}$/.test(code)) {
      const step = this.totp.verify(staff.totpSecretEnc as string, code);
      if (step === null) return null;
      const claimed: unknown = await this.staffRepo.query(
        `UPDATE staff_users SET totp_last_step = $2
         WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
         RETURNING id`,
        [staff.id, step],
      );
      const rows = Array.isArray(claimed) ? (claimed[0] as unknown) : [];
      return Array.isArray(rows) && rows.length > 0 ? 'totp' : null;
    }

    const hash = this.totp.hashRecovery(code);
    const spent: unknown = await this.staffRepo.query(
      `UPDATE staff_users
          SET recovery_code_hashes = recovery_code_hashes - $2::text
        WHERE id = $1 AND recovery_code_hashes ? $2::text
        RETURNING id`,
      [staff.id, hash],
    );
    const rows = Array.isArray(spent) ? (spent[0] as unknown) : [];
    return Array.isArray(rows) && rows.length > 0 ? 'recovery' : null;
  }

  // --- Second factor: enrolment ---------------------------------------------

  /** Begins enrolment from the sign-in step (2FA required, not yet set up). */
  async startEnrollmentWithToken(mfaToken: string) {
    const staff = await this.readMfaToken(mfaToken, 'enroll');
    return this.startEnrollment(staff.id);
  }

  async confirmEnrollmentWithToken(
    mfaToken: string,
    code: string,
    ip: string | null,
  ) {
    const staff = await this.readMfaToken(mfaToken, 'enroll');
    const { recoveryCodes } = await this.confirmEnrollment(staff.id, code, ip);
    const fresh = await this.staffRepo.findOneByOrFail({ id: staff.id });
    const session = await this.completeLogin(fresh, ip, 'enrolment');
    return { ...session, recoveryCodes };
  }

  /** Generates a pending secret. Not active until a code from it is confirmed. */
  async startEnrollment(staffId: string) {
    const staff = await this.staffRepo.findOneByOrFail({ id: staffId });
    if (staff.totpEnabledAt) {
      throw new ConflictException('Two-factor authentication is already on');
    }
    const { secret, otpauthUrl, encrypted } = this.totp.newSecret(staff.email);
    await this.staffRepo.update(staff.id, {
      totpSecretEnc: encrypted,
      totpLastStep: null,
    });
    return { secret, otpauthUrl };
  }

  async confirmEnrollment(staffId: string, code: string, ip: string | null) {
    const staff = await this.staffRepo.findOneByOrFail({ id: staffId });
    if (staff.totpEnabledAt || !staff.totpSecretEnc) {
      throw new BadRequestException('Start two-factor setup first');
    }

    const attempt = await this.reserveAttempt(staff.id);
    if (!attempt.allowed) throw this.lockedError();

    const step = this.totp.verify(staff.totpSecretEnc, code);
    if (step === null) throw new UnauthorizedException('Invalid code');

    // A correct confirmation must not leave a spent attempt behind.
    await this.resetAttempts(staff.id);
    const { codes, hashes } = this.totp.newRecoveryCodes();
    await this.staffRepo.update(staff.id, {
      totpEnabledAt: new Date(),
      totpLastStep: String(step),
      recoveryCodeHashes: hashes,
    });
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action: 'auth.mfa_enrolled',
      ip,
    });
    return { recoveryCodes: codes };
  }

  /** Turning 2FA off needs the password and a current code — and is refused
   *  outright when the deployment requires 2FA for everyone. */
  async disableTwoFactor(
    staffId: string,
    password: string,
    code: string,
    ip: string | null,
  ) {
    if (this.config.get('totp', { infer: true }).required) {
      throw new ForbiddenException(
        'Two-factor authentication is required for all staff',
      );
    }
    const staff = await this.staffRepo.findOneByOrFail({ id: staffId });
    if (!staff.totpEnabledAt || !staff.totpSecretEnc) {
      throw new BadRequestException('Two-factor authentication is not on');
    }
    const attempt = await this.reserveAttempt(staff.id);
    if (!attempt.allowed) throw this.lockedError();
    if (
      !(await argon2.verify(staff.passwordHash, password)) ||
      !(await this.checkSecondFactor(staff, code))
    ) {
      throw new UnauthorizedException('Password or code is incorrect');
    }
    await this.resetAttempts(staff.id);
    await this.clearTwoFactor(staff.id);
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action: 'auth.mfa_disabled',
      ip,
    });
  }

  /** Replaces the recovery codes (old ones stop working). Needs a live code. */
  async regenerateRecoveryCodes(
    staffId: string,
    code: string,
    ip: string | null,
  ) {
    const staff = await this.staffRepo.findOneByOrFail({ id: staffId });
    if (!staff.totpEnabledAt || !staff.totpSecretEnc) {
      throw new BadRequestException('Two-factor authentication is not on');
    }
    const attempt = await this.reserveAttempt(staff.id);
    if (!attempt.allowed) throw this.lockedError();
    if ((await this.checkSecondFactor(staff, code)) !== 'totp') {
      throw new UnauthorizedException('Invalid code');
    }
    await this.resetAttempts(staff.id);
    const { codes, hashes } = this.totp.newRecoveryCodes();
    await this.staffRepo.update(staff.id, { recoveryCodeHashes: hashes });
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action: 'auth.mfa_recovery_codes_regenerated',
      ip,
    });
    return { recoveryCodes: codes };
  }

  /** Wipes a staff member's second factor (also used by super-admin reset). */
  clearTwoFactor(staffId: string) {
    return this.staffRepo.update(staffId, {
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodeHashes: [],
    });
  }

  // --- Sessions -------------------------------------------------------------

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
        twoFactorEnabled: !!staff.totpEnabledAt,
      },
    };
  }
}
