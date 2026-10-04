import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { StaffRefreshToken } from '../auth/entities/staff-refresh-token.entity';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import {
  StaffRole,
  StaffStatus,
  StaffUser,
} from './entities/staff-user.entity';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(StaffUser) private readonly repo: Repository<StaffUser>,
    @InjectRepository(StaffRefreshToken)
    private readonly refreshRepo: Repository<StaffRefreshToken>,
    private readonly audit: AuditService,
  ) {}

  private view(s: StaffUser) {
    return {
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      role: s.role,
      status: s.status,
      mustChangePassword: s.mustChangePassword,
      twoFactorEnabled: !!s.totpEnabledAt,
      lastLoginAt: s.lastLoginAt,
      createdAt: s.createdAt,
    };
  }

  private detailView(s: StaffUser, activeSessions: number) {
    return {
      ...this.view(s),
      failedLoginAttempts: s.failedLoginAttempts,
      lockedUntil: s.lockedUntil,
      isLocked: !!s.lockedUntil && s.lockedUntil > new Date(),
      activeSessions,
    };
  }

  async get(id: string) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    const activeSessions = await this.refreshRepo.countBy({
      staffId: id,
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
    return this.detailView(staff, activeSessions);
  }

  async list() {
    const rows = await this.repo.find({ order: { createdAt: 'ASC' } });
    return rows.map((s) => this.view(s));
  }

  // The temporary password is returned exactly once, here — there is no
  // email delivery for staff invites yet, so the super admin hands it over.
  async create(
    dto: CreateStaffDto,
    actor: AuthenticatedStaff,
    ip: string | null,
  ) {
    const email = dto.email.trim().toLowerCase();
    if (await this.repo.existsBy({ email })) {
      throw new ConflictException('A staff member with this email exists');
    }
    const temporaryPassword = randomBytes(12).toString('base64url');
    const staff = await this.repo.save(
      this.repo.create({
        fullName: dto.fullName.trim(),
        email,
        role: dto.role,
        passwordHash: await argon2.hash(temporaryPassword, {
          type: argon2.argon2id,
        }),
        mustChangePassword: true,
      }),
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.created',
      resourceType: 'staff',
      resourceId: staff.id,
      metadata: { email, role: dto.role },
      ip,
    });
    return { ...this.view(staff), temporaryPassword };
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    actor: AuthenticatedStaff,
    ip: string | null,
  ) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    if (id === actor.staffId) {
      throw new BadRequestException(
        'You cannot change your own role or status',
      );
    }
    await this.guardLastSuperAdmin(staff, dto);

    const before = { role: staff.role, status: staff.status };
    if (dto.role) staff.role = dto.role;
    if (dto.status) staff.status = dto.status;
    await this.repo.save(staff);

    if (dto.status === StaffStatus.DISABLED) {
      await this.refreshRepo.update(
        { staffId: id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.updated',
      resourceType: 'staff',
      resourceId: id,
      metadata: { before, after: { role: staff.role, status: staff.status } },
      ip,
    });
    return this.view(staff);
  }

  async resetTwoFactor(
    id: string,
    actor: AuthenticatedStaff,
    ip: string | null,
  ) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    await this.repo.update(id, {
      totpSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodeHashes: [],
    });
    await this.refreshRepo.update(
      { staffId: id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.mfa_reset',
      resourceType: 'staff',
      resourceId: id,
      ip,
    });
    return { ok: true };
  }

  async resetPassword(
    id: string,
    actor: AuthenticatedStaff,
    ip: string | null,
  ) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    const temporaryPassword = randomBytes(12).toString('base64url');
    await this.repo.update(id, {
      passwordHash: await argon2.hash(temporaryPassword, {
        type: argon2.argon2id,
      }),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await this.refreshRepo.update(
      { staffId: id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.password_reset',
      resourceType: 'staff',
      resourceId: id,
      ip,
    });
    return { temporaryPassword };
  }

  async unlock(id: string, actor: AuthenticatedStaff, ip: string | null) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    await this.repo.update(id, { failedLoginAttempts: 0, lockedUntil: null });
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.unlocked',
      resourceType: 'staff',
      resourceId: id,
      metadata: { email: staff.email },
      ip,
    });
    return this.get(id);
  }

  // Audit rows carry their own staffEmail snapshot and have no FK to this
  // table, so history stays readable after the account is gone. Disabling
  // first is required so a delete is never the first step against a live
  // account (it also revokes the sessions).
  async remove(id: string, actor: AuthenticatedStaff, ip: string | null) {
    const staff = await this.repo.findOneBy({ id });
    if (!staff) throw new NotFoundException();
    if (id === actor.staffId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    if (staff.status !== StaffStatus.DISABLED) {
      throw new BadRequestException('Disable the account before deleting it');
    }
    await this.refreshRepo.delete({ staffId: id });
    await this.repo.delete(id);
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'staff.deleted',
      resourceType: 'staff',
      resourceId: id,
      metadata: {
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
      },
      ip,
    });
    return { deleted: true };
  }

  private async guardLastSuperAdmin(staff: StaffUser, dto: UpdateStaffDto) {
    if (staff.role !== StaffRole.SUPER_ADMIN) return;
    const demoting = dto.role && dto.role !== StaffRole.SUPER_ADMIN;
    const disabling = dto.status === StaffStatus.DISABLED;
    if (!demoting && !disabling) return;
    const remaining = await this.repo.countBy({
      role: StaffRole.SUPER_ADMIN,
      status: StaffStatus.ACTIVE,
    });
    if (remaining <= 1) {
      throw new BadRequestException(
        'At least one active super admin is required',
      );
    }
  }
}
