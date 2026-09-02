import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CurrencyCode, sha256 } from '@app/common';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { PasswordService } from '../credentials/password.service';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '../otp/entities/otp.entity';
import { SessionsService } from '../sessions/sessions.service';
import { TokensService, TokenPair } from '../tokens/tokens.service';
import { DevicesService } from '../devices/devices.service';
import { BVN_PROVIDER } from '../kyc/bvn-provider.interface';
import type { BvnProvider } from '../kyc/bvn-provider.interface';
import { normalizeDobToIso } from '../kyc/dob.util';
import { normalizeNigerianPhone } from '../phone/phone.util';
import { RegisterDto } from './dto/register.dto';
import { PendingLogin } from './entities/pending-login.entity';
import { generateRefreshToken } from '../tokens/token.util';
import { PaymentProvisioningPublisher } from '../messaging/payment-provisioning.publisher';
import { NotificationPublisher } from '../messaging/notification.publisher';

export interface RequestMeta {
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface OnboardingProgress {
  emailVerified: boolean;
  phoneVerified: boolean;
  bvnVerified: boolean;
  pinSet: boolean;
  onboardingComplete: boolean;
}

export type LoginResult =
  | { pinRequired: true; loginTicket: string }
  | (TokenPair & { pinRequired: false; progress: OnboardingProgress });

// How long a PIN-confirmation ticket from an unrecognized-device login stays
// valid before the client has to sign in again.
const LOGIN_TICKET_TTL_MS = 5 * 60 * 1000;
const LOGIN_TICKET_MAX_ATTEMPTS = 5;

function progressOf(user: User): OnboardingProgress {
  const emailVerified = !!user.emailVerifiedAt;
  const phoneVerified = !!user.phoneVerifiedAt;
  const bvnVerified = !!user.bvnVerifiedAt;
  const pinSet = !!user.transactionPinHash;
  return {
    emailVerified,
    phoneVerified,
    bvnVerified,
    pinSet,
    onboardingComplete: emailVerified && phoneVerified && bvnVerified,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly otpService: OtpService,
    private readonly sessionsService: SessionsService,
    private readonly tokensService: TokensService,
    private readonly devicesService: DevicesService,
    @InjectRepository(PendingLogin)
    private readonly pendingLoginsRepo: Repository<PendingLogin>,
    @Inject(BVN_PROVIDER) private readonly bvnProvider: BvnProvider,
    private readonly paymentProvisioningPublisher: PaymentProvisioningPublisher,
    private readonly notificationPublisher: NotificationPublisher,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<{ userId: string; email: string; otp: string }> {
    let user = await this.usersService.findByEmail(dto.email);
    if (user && user.status === UserStatus.ACTIVE) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    if (user) {
      // Unverified account resuming an earlier attempt — refresh their
      // details rather than blocking on the still-pending email OTP.
      await this.usersService.updateRegistrationDetails(user.id, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash,
      });
    } else {
      user = await this.usersService.create({
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });
    }

    // Dumb OTP: this is a demo build with no real mailer wired up yet, so
    // the code is handed straight back to the caller instead of emailed.
    const otp = await this.otpService.generate(
      user.id,
      OtpPurpose.REGISTRATION,
    );
    return { userId: user.id, email: user.email, otp };
  }

  async resendRegistrationOtp(email: string): Promise<{ otp: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.emailVerifiedAt) {
      throw new BadRequestException('No pending registration for this email');
    }
    const otp = await this.otpService.generate(
      user.id,
      OtpPurpose.REGISTRATION,
    );
    return { otp };
  }

  async verifyOtp(
    email: string,
    code: string,
    purpose: OtpPurpose,
    meta: RequestMeta,
  ): Promise<TokenPair & { progress: OnboardingProgress }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const isValid = await this.otpService.verify(user.id, purpose, code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (purpose === OtpPurpose.REGISTRATION) {
      await this.usersService.markEmailVerified(user.id);
    }

    // One active session per customer — a second device resuming the same
    // pending registration (or any other prior session) must not stay live
    // once this one takes over. createExclusive revokes-and-creates
    // atomically (see its doc comment) so this holds even under concurrent
    // requests, not just sequential ones.
    await this.tokensService.revokeAllRefreshTokensForUser(user.id);

    const refreshed = await this.usersService.findById(user.id);
    const session = await this.sessionsService.createExclusive({
      userId: user.id,
      ...meta,
    });
    // Completing an OTP step is itself a strong proof of ownership — the
    // device that finished registration doesn't need a PIN challenge on its
    // very next login (it won't have a PIN yet anyway at this point).
    if (meta.deviceId) {
      await this.devicesService.trust(user.id, meta.deviceId, meta.deviceName);
    }
    const tokens = await this.tokensService.issueTokenPair(user.id, session.id);
    return { ...tokens, progress: progressOf(refreshed) };
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await this.passwordService.verify(
      user.passwordHash,
      password,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // No PIN set yet is only possible mid-onboarding (before the mandatory
    // post-signup PIN prompt) — nothing to challenge against, so let the
    // wizard resume normally rather than demanding a PIN that can't exist.
    const deviceRecognized = !user.transactionPinHash
      ? true
      : await this.devicesService.isTrusted(user.id, meta.deviceId);

    if (deviceRecognized) {
      if (meta.deviceId) {
        await this.devicesService.trust(
          user.id,
          meta.deviceId,
          meta.deviceName,
        );
      }
      // One active session per customer — logging in here must invalidate
      // whatever was still active elsewhere immediately, not just on that
      // other session's next natural expiry. createExclusive makes the
      // revoke-then-create atomic per user, closing the race where two
      // concurrent logins could otherwise both end up active.
      await this.tokensService.revokeAllRefreshTokensForUser(user.id);

      const session = await this.sessionsService.createExclusive({
        userId: user.id,
        ...meta,
      });
      const tokens = await this.tokensService.issueTokenPair(
        user.id,
        session.id,
      );
      return { ...tokens, pinRequired: false, progress: progressOf(user) };
    }

    const loginTicket = generateRefreshToken();
    await this.pendingLoginsRepo.save(
      this.pendingLoginsRepo.create({
        userId: user.id,
        ticketHash: sha256(loginTicket),
        deviceId: meta.deviceId ?? null,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: new Date(Date.now() + LOGIN_TICKET_TTL_MS),
      }),
    );
    return { pinRequired: true, loginTicket };
  }

  async confirmLoginPin(
    loginTicket: string,
    pin: string,
    meta: RequestMeta,
  ): Promise<TokenPair & { progress: OnboardingProgress }> {
    const pending = await this.pendingLoginsRepo.findOne({
      where: { ticketHash: sha256(loginTicket) },
    });
    if (
      !pending ||
      pending.consumedAt ||
      pending.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        'Login session expired — please sign in again',
      );
    }
    if (pending.attempts >= LOGIN_TICKET_MAX_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many attempts — please sign in again',
      );
    }

    const user = await this.usersService.findById(pending.userId);
    if (!user.transactionPinHash) {
      throw new UnauthorizedException('Transaction PIN not set');
    }

    const pinMatches = await this.passwordService.verify(
      user.transactionPinHash,
      pin,
    );
    if (!pinMatches) {
      await this.pendingLoginsRepo.update(pending.id, {
        attempts: pending.attempts + 1,
      });
      throw new UnauthorizedException('Incorrect PIN');
    }

    await this.pendingLoginsRepo.update(pending.id, {
      consumedAt: new Date(),
    });

    const deviceId = pending.deviceId ?? meta.deviceId;
    if (deviceId) {
      await this.devicesService.trust(user.id, deviceId, meta.deviceName);
    }

    // One active session per customer — this confirm is the moment the new
    // device fully takes over, so whatever was active elsewhere ends now.
    // createExclusive makes the revoke-then-create atomic per user.
    await this.tokensService.revokeAllRefreshTokensForUser(user.id);

    const session = await this.sessionsService.createExclusive({
      userId: user.id,
      deviceId: deviceId ?? undefined,
      deviceName: meta.deviceName,
      userAgent: pending.userAgent ?? meta.userAgent,
      ipAddress: pending.ipAddress ?? meta.ipAddress,
    });
    const tokens = await this.tokensService.issueTokenPair(user.id, session.id);
    return { ...tokens, progress: progressOf(user) };
  }

  async setTransactionPin(
    userId: string,
    pin: string,
    confirmPin: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (user.transactionPinHash) {
      // Initial creation only — an existing PIN must go through
      // resetTransactionPin, which proves knowledge of the current one
      // first rather than letting anyone with a live session overwrite it.
      throw new ConflictException(
        'Transaction PIN already set — use reset instead',
      );
    }
    if (pin !== confirmPin) {
      throw new BadRequestException("PINs don't match");
    }
    const pinHash = await this.passwordService.hash(pin);
    await this.usersService.setTransactionPin(userId, pinHash);
    const updated = await this.usersService.findById(userId);
    await this.maybeRequestPaymentProvisioning(updated);
  }

  async verifyTransactionPin(userId: string, pin: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user.transactionPinHash) {
      throw new BadRequestException('No transaction PIN set');
    }
    const matches = await this.passwordService.verify(
      user.transactionPinHash,
      pin,
    );
    if (!matches) {
      throw new UnauthorizedException('Incorrect PIN');
    }
  }

  async resetTransactionPin(
    userId: string,
    currentPin: string,
    newPin: string,
    confirmNewPin: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user.transactionPinHash) {
      throw new BadRequestException(
        'No transaction PIN set — use create instead',
      );
    }
    const currentMatches = await this.passwordService.verify(
      user.transactionPinHash,
      currentPin,
    );
    if (!currentMatches) {
      throw new UnauthorizedException('Current PIN is incorrect');
    }
    if (newPin !== confirmNewPin) {
      throw new BadRequestException("PINs don't match");
    }
    if (newPin === currentPin) {
      throw new BadRequestException(
        'New PIN must be different from your current PIN',
      );
    }
    const pinHash = await this.passwordService.hash(newPin);
    await this.usersService.setTransactionPin(userId, pinHash);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    confirmNewPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    const currentMatches = await this.passwordService.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!currentMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException("Passwords don't match");
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        'New password must be different from your current password',
      );
    }
    const passwordHash = await this.passwordService.hash(newPassword);
    await this.usersService.updatePassword(userId, passwordHash);
    // Keep the session that just proved the current password alive; any
    // other lingering session (there shouldn't normally be one, given
    // single-session enforcement, but this is cheap defense-in-depth) ends
    // here rather than surviving next to the new password.
    await this.sessionsService.revokeAllForUserExcept(userId, sessionId);
    await this.tokensService.revokeAllRefreshTokensForUserExcept(
      userId,
      sessionId,
    );
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokensService.rotateRefreshToken(refreshToken);
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessionsService.revoke(sessionId, userId);
    await this.tokensService.revokeSession(sessionId);
  }

  async me(userId: string, deviceId?: string) {
    const user = await this.usersService.findById(userId);
    const device = deviceId
      ? await this.devicesService.findTrustedDevice(userId, deviceId)
      : null;
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      tier: user.tier,
      tierUpgradeStatus: user.tierUpgradeStatus,
      tierUpgradeSubmittedAt: user.tierUpgradeSubmittedAt,
      biometricLoginEnabled: device?.biometricLoginEnabled ?? false,
      biometricTransactionEnabled: device?.biometricTransactionEnabled ?? false,
      ...progressOf(user),
    };
  }

  async addPhone(userId: string, rawPhone: string): Promise<{ phone: string }> {
    let phone: string;
    try {
      phone = normalizeNigerianPhone(rawPhone);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const existing = await this.usersService.findByPhone(phone);
    if (existing && existing.id !== userId) {
      throw new ConflictException(
        'This phone number is already linked to another account',
      );
    }

    await this.usersService.setPhone(userId, phone);
    const code = await this.otpService.generate(
      userId,
      OtpPurpose.PHONE_VERIFICATION,
    );
    // Delivery is now postoffice's job (queued over RabbitMQ) — this only
    // fails if the broker itself is unreachable, not if the SMS bounces, so
    // there's no send-result left here to purge the OTP over on failure.
    this.notificationPublisher.requestSms(
      phone,
      `Your Fiam verification code is ${code}. It expires in 5 minutes.`,
    );
    return { phone };
  }

  async resendPhoneOtp(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user.phone) {
      throw new BadRequestException('No phone number on file');
    }
    const code = await this.otpService.generate(
      userId,
      OtpPurpose.PHONE_VERIFICATION,
    );
    this.notificationPublisher.requestSms(
      user.phone,
      `Your Fiam verification code is ${code}. It expires in 5 minutes.`,
    );
  }

  async verifyPhoneOtp(
    userId: string,
    code: string,
  ): Promise<OnboardingProgress> {
    const isValid = await this.otpService.verify(
      userId,
      OtpPurpose.PHONE_VERIFICATION,
      code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.usersService.markPhoneVerified(userId);
    const user = await this.usersService.findById(userId);
    return progressOf(user);
  }

  async submitBvn(
    userId: string,
    bvn: string,
    dateOfBirth: string,
  ): Promise<{ otp: string }> {
    const user = await this.usersService.findById(userId);

    const existing = await this.usersService.findByBvn(bvn);
    if (existing && existing.id !== userId) {
      throw new ConflictException(
        'This BVN is already linked to another account',
      );
    }

    const result = await this.bvnProvider.verify(bvn, {
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (!result.matched) {
      throw new BadRequestException(
        'BVN details do not match your registered name',
      );
    }

    // Customer-entered DOB is canonical (it's what gets sent to VFD later),
    // but cross-check it against the provider's own returned DOB when
    // available — same spirit as the name-match check above, catching a
    // customer who fat-fingered their date of birth. A provider DOB we
    // can't parse doesn't block submission (format isn't guaranteed — see
    // normalizeDobToIso's doc comment); we just skip the cross-check and
    // trust the customer-entered value.
    if (result.dob) {
      try {
        const providerDob = normalizeDobToIso(result.dob);
        if (providerDob !== dateOfBirth) {
          throw new BadRequestException(
            'Date of birth does not match your registered BVN details',
          );
        }
      } catch (err) {
        if (err instanceof BadRequestException) {
          throw err;
        }
        this.logger.error(
          `Could not parse BVN provider DOB for comparison (user ${userId}): ${(err as Error).message}`,
        );
      }
    }

    await this.usersService.setBvn(userId, bvn);
    await this.usersService.setDateOfBirth(userId, dateOfBirth);
    // Dumb OTP for demo purposes — QoreID's BVN lookup has no OTP dispatch
    // of its own, so we generate/hash/store our own the same way as email.
    const otp = await this.otpService.generate(
      userId,
      OtpPurpose.BVN_VERIFICATION,
    );
    return { otp };
  }

  async verifyBvnOtp(
    userId: string,
    code: string,
  ): Promise<OnboardingProgress> {
    const isValid = await this.otpService.verify(
      userId,
      OtpPurpose.BVN_VERIFICATION,
      code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    await this.usersService.markBvnVerified(userId);
    const user = await this.usersService.findById(userId);
    await this.maybeRequestPaymentProvisioning(user);
    return progressOf(user);
  }

  // BVN-verification and PIN-set are two independent completion paths for
  // the same precondition ("customer is ready for an NGN wallet") — either
  // one can be the one that finishes second, so both call this. The DB claim
  // (see UsersService.claimPaymentAccountProvisioning) ensures only one
  // publish ever happens per user.
  private async maybeRequestPaymentProvisioning(user: User): Promise<void> {
    if (!user.bvnVerifiedAt || !user.transactionPinHash) {
      return;
    }
    const claimed = await this.usersService.claimPaymentAccountProvisioning(
      user.id,
    );
    if (!claimed) {
      return;
    }
    if (!user.bvn || !user.dateOfBirth) {
      this.logger.error(
        `Cannot request payment provisioning for user ${user.id}: missing bvn/dateOfBirth`,
      );
      return;
    }
    this.paymentProvisioningPublisher.requestNgnAccountProvisioning({
      messageId: randomUUID(),
      userId: user.id,
      currency: CurrencyCode.NGN,
      bvn: user.bvn,
      dateOfBirth: user.dateOfBirth,
      firstName: user.firstName,
      lastName: user.lastName,
      requestedAt: new Date().toISOString(),
    });
  }

  async requestPasswordReset(email: string): Promise<{ otp: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('No account found with this email');
    }
    // Dumb OTP for demo purposes, same as the other OTP steps — no real
    // mailer is wired up yet, so the code is handed back in the response.
    const otp = await this.otpService.generate(
      user.id,
      OtpPurpose.PASSWORD_RESET,
    );
    return { otp };
  }

  async verifyPasswordResetOtp(
    email: string,
    code: string,
  ): Promise<{ resetToken: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    const isValid = await this.otpService.verify(
      user.id,
      OtpPurpose.PASSWORD_RESET,
      code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    const resetToken = await this.tokensService.issuePasswordResetToken(
      user.id,
    );
    return { resetToken };
  }

  async confirmPasswordReset(
    resetToken: string,
    newPassword: string,
  ): Promise<void> {
    const userId =
      await this.tokensService.consumePasswordResetToken(resetToken);
    const passwordHash = await this.passwordService.hash(newPassword);
    await this.usersService.updatePassword(userId, passwordHash);
    // A password reset is a strong signal the account may have been
    // compromised — sign every existing session out rather than leaving a
    // possibly-stolen session alive next to the new password.
    await this.sessionsService.revokeAllForUser(userId);
    await this.tokensService.revokeAllRefreshTokensForUser(userId);
  }
}
