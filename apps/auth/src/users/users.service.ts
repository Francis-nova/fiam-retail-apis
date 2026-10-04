import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthConfig } from '../config/configuration';
import { Repository } from 'typeorm';
import {
  CustomerTier,
  TierUpgradeStatus,
  User,
  UserStatus,
} from './entities/user.entity';

// Emails are case-insensitive in practice (every real provider treats them
// that way) but Postgres' unique index isn't — normalize on every write and
// read so "User@x.com" and "user@x.com" can never diverge into two accounts
// or lock a verified user out of login over casing.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 5 wrong tries lock that secret for 15 minutes. A 4-digit PIN has only
// 10,000 values, so the limit has to be per account (not per IP/session).
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60;

export type SecretKind = 'password' | 'pin';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { email: normalizeEmail(email) } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { phone } });
  }

  findByBvn(bvn: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { bvn } });
  }

  findByNin(nin: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { nin } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  create(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  }): Promise<User> {
    const user = this.usersRepo.create({
      ...data,
      email: normalizeEmail(data.email),
    });
    return this.usersRepo.save(user);
  }

  async updateRegistrationDetails(
    id: string,
    data: { firstName: string; lastName: string; passwordHash: string },
  ): Promise<void> {
    await this.usersRepo.update(id, data);
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.usersRepo.update(id, {
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });
  }

  async setPhone(id: string, phone: string): Promise<void> {
    await this.usersRepo.update(id, { phone });
  }

  async markPhoneVerified(id: string): Promise<void> {
    await this.usersRepo.update(id, { phoneVerifiedAt: new Date() });
  }

  async setBvn(id: string, bvn: string): Promise<void> {
    await this.usersRepo.update(id, { bvn });
  }

  async markBvnVerified(id: string): Promise<void> {
    await this.usersRepo.update(id, { bvnVerifiedAt: new Date() });
  }

  async setDateOfBirth(id: string, dateOfBirth: string): Promise<void> {
    await this.usersRepo.update(id, { dateOfBirth });
  }

  // No separate submit-then-verify steps like BVN's (no OTP hop for NIN) —
  // set and mark verified together, only ever called once QoreID has
  // already confirmed a name match.
  async setNinVerified(id: string, nin: string): Promise<void> {
    await this.usersRepo.update(id, { nin, ninVerifiedAt: new Date() });
  }

  // Atomic conditional claim — not read-then-write — so the two independent
  // completion paths (BVN-verify, PIN-set) can't both publish a provisioning
  // request under a race. Returns true only for the caller that actually won
  // the claim.
  async claimPaymentAccountProvisioning(id: string): Promise<boolean> {
    const result = await this.usersRepo
      .createQueryBuilder()
      .update(User)
      .set({ paymentAccountProvisioningRequestedAt: () => 'now()' })
      .where('id = :id AND payment_account_provisioning_requested_at IS NULL', {
        id,
      })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(id, { passwordHash });
  }

  async setTransactionPin(
    id: string,
    transactionPinHash: string,
  ): Promise<void> {
    await this.usersRepo.update(id, {
      transactionPinHash,
      transactionPinSetAt: new Date(),
    });
  }

  async setTierUpgradeStatus(
    id: string,
    status: TierUpgradeStatus,
    submittedAt: Date | null,
  ): Promise<void> {
    await this.usersRepo.update(id, {
      tierUpgradeStatus: status,
      tierUpgradeSubmittedAt: submittedAt,
      // A fresh submission supersedes any earlier decision.
      tierUpgradeDecidedAt: null,
      tierUpgradeDecisionNote: null,
    });
  }

  // --- Console-driven account administration (see internal/account-admin) ---

  async setStatus(id: string, status: UserStatus): Promise<void> {
    await this.usersRepo.update(id, { status });
  }

  async updateProfileFields(
    id: string,
    data: { firstName?: string; lastName?: string; phone?: string },
  ): Promise<void> {
    await this.usersRepo.update(id, data);
  }

  // Phone changed by staff: the new number has not been proven yet.
  async setPhoneUnverified(id: string, phone: string): Promise<void> {
    await this.usersRepo.update(id, { phone, phoneVerifiedAt: null });
  }

  // Frees the email/phone for reuse while keeping the row (and with it the
  // KYC identifiers and every record that references this user id).
  async markClosed(id: string, anonymizedEmail: string): Promise<void> {
    await this.usersRepo.update(id, {
      status: UserStatus.CLOSED,
      closedAt: new Date(),
      email: anonymizedEmail,
      phone: null,
      phoneVerifiedAt: null,
    });
  }

  // Applies a review decision only if the upgrade is still UNDER_REVIEW, in a
  // single conditional UPDATE — two reviewers deciding at once can't both win.
  // Returns false when it was no longer under review.
  async decideTierUpgrade(
    id: string,
    decision: TierUpgradeStatus.APPROVED | TierUpgradeStatus.REJECTED,
    note: string | null,
  ): Promise<boolean> {
    const result = await this.usersRepo
      .createQueryBuilder()
      .update(User)
      .set({
        tierUpgradeStatus: decision,
        tierUpgradeDecidedAt: new Date(),
        tierUpgradeDecisionNote: note,
        ...(decision === TierUpgradeStatus.APPROVED
          ? { tier: CustomerTier.TIER_3 }
          : {}),
      })
      .where('id = :id AND tier_upgrade_status = :under', {
        id,
        under: TierUpgradeStatus.UNDER_REVIEW,
      })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Runs `check` (a password/PIN comparison) under a per-account attempt
   * limit. The attempt is reserved with one atomic UPDATE *before* `check`
   * runs, so a burst of parallel guesses can't all pass a stale "not locked"
   * read: once MAX_FAILED_ATTEMPTS are reserved the row is locked and every
   * further call is rejected without being evaluated. A correct answer clears
   * the counter. `onLockout` fires once, on the wrong guess that trips the
   * lock, so the owner can be alerted exactly once per attack.
   */
  async guardedVerify(
    userId: string,
    kind: SecretKind,
    check: () => Promise<boolean>,
    onLockout?: () => void,
  ): Promise<boolean> {
    // `kind` is a closed union, never user input, so interpolating the column
    // prefix is safe.
    const attempts = `${kind}_failed_attempts`;
    const lockedUntil = `${kind}_locked_until`;
    const expired = `(${lockedUntil} IS NOT NULL AND ${lockedUntil} <= now())`;
    const next = `(CASE WHEN ${expired} THEN 1 ELSE ${attempts} + 1 END)`;
    const reserved: unknown = await this.usersRepo.query(
      `UPDATE users SET
         ${attempts} = ${next},
         ${lockedUntil} = CASE WHEN ${next} >= $2
                               THEN now() + make_interval(secs => $3)
                               ELSE NULL END
       WHERE id = $1 AND (${lockedUntil} IS NULL OR ${expired})
       RETURNING ${lockedUntil} IS NOT NULL AS locked`,
      [userId, MAX_FAILED_ATTEMPTS, LOCKOUT_SECONDS],
    );
    // pg returns [rows, affectedCount] for UPDATE ... RETURNING.
    const rows = Array.isArray(reserved) ? (reserved[0] as unknown) : [];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new HttpException(
        `Too many failed attempts. Try again in ${Math.ceil(LOCKOUT_SECONDS / 60)} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await check();
    if (!ok && (rows[0] as { locked?: boolean }).locked) {
      onLockout?.();
    }
    if (ok) {
      await this.usersRepo.query(
        `UPDATE users SET ${attempts} = 0, ${lockedUntil} = NULL WHERE id = $1`,
        [userId],
      );
    }
    return ok;
  }

  /** Support action: clears the password and PIN lockouts (not the device limit). */
  async clearLockouts(userId: string): Promise<void> {
    await this.usersRepo.query(
      `UPDATE users SET password_failed_attempts = 0, password_locked_until = NULL,
                        pin_failed_attempts = 0, pin_locked_until = NULL
        WHERE id = $1`,
      [userId],
    );
  }

  // --- New-device outflow limit (CBN circular, 12 Mar 2026) ---

  get deviceLimitHours(): number {
    return this.configService.get('deviceLimit', { infer: true }).hours;
  }

  /** Opens (or restarts) the limit window: now .. now + 24h. */
  async startDeviceLimit(userId: string): Promise<void> {
    await this.usersRepo.query(
      `UPDATE users SET device_limit_until = now() + make_interval(hours => $2)
       WHERE id = $1`,
      [userId, this.deviceLimitHours],
    );
  }

  /**
   * The customer's current outflow restriction, or null when none applies.
   * `amount` is the cumulative cap over the window [since, until).
   */
  transferLimitFor(user: Pick<User, 'deviceLimitUntil'>): {
    amount: string;
    since: string;
    until: string;
  } | null {
    const until = user.deviceLimitUntil;
    if (!until || until.getTime() <= Date.now()) return null;
    const { amountNgn, hours } = this.configService.get('deviceLimit', {
      infer: true,
    });
    return {
      amount: Number(amountNgn).toFixed(2),
      since: new Date(until.getTime() - hours * 3_600_000).toISOString(),
      until: until.toISOString(),
    };
  }
}
