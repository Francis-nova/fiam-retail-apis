import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TierUpgradeStatus, User, UserStatus } from './entities/user.entity';

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
    });
  }
}
