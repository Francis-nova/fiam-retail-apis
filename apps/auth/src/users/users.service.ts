import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
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
}
