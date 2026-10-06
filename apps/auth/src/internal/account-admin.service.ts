import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PushTemplate } from '@app/common';
import { UsersService } from '../users/users.service';
import {
  TierUpgradeStatus,
  User,
  UserStatus,
} from '../users/entities/user.entity';
import { KycDocument } from '../kyc/entities/kyc-document.entity';
import { REQUIRED_DOC_TYPES } from '../kyc/kyc-documents.service';
import { StorageService } from '../storage/storage.service';
import { NotificationPublisher } from '../messaging/notification.publisher';
import { DeletionService } from '../deletion/deletion.service';
import { SessionsService } from '../sessions/sessions.service';
import { TokensService } from '../tokens/tokens.service';
import { normalizeNigerianPhone } from '../phone/phone.util';
import { UpdateProfileDto } from './account-admin.dto';

// Back-office account actions, called by the admin console over /internal.
// All business rules live here (not in the console) so they hold no matter
// who calls: e.g. a suspend always kills live sessions, and a reactivate can
// never turn an unverified signup into an ACTIVE account.
@Injectable()
export class AccountAdminService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
    private readonly dataSource: DataSource,
    @InjectRepository(KycDocument)
    private readonly docs: Repository<KycDocument>,
    private readonly storage: StorageService,
    private readonly notifications: NotificationPublisher,
    private readonly deletion: DeletionService,
  ) {}

  private async endAllSessions(userId: string) {
    await this.sessions.revokeAllForUser(userId);
    await this.tokens.revokeAllRefreshTokensForUser(userId);
  }

  private view(u: User) {
    return {
      id: u.id,
      status: u.status,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      closedAt: u.closedAt,
    };
  }

  async suspend(id: string) {
    const user = await this.users.findById(id);
    if (user.status === UserStatus.SUSPENDED) return this.view(user);
    if (user.status === UserStatus.CLOSED) {
      throw new BadRequestException('This account is closed');
    }
    await this.users.setStatus(id, UserStatus.SUSPENDED);
    // The JWT strategy only checks the session row, so this is what makes the
    // suspension bite immediately rather than when the access token expires.
    await this.endAllSessions(id);
    return this.view(await this.users.findById(id));
  }

  async reactivate(id: string) {
    const user = await this.users.findById(id);
    if (user.status !== UserStatus.SUSPENDED) {
      throw new BadRequestException(
        'Only a suspended account can be reactivated',
      );
    }
    // Back to where they were: a customer suspended mid-signup must still
    // finish verification; reactivation is not a way around it.
    await this.users.setStatus(
      id,
      user.emailVerifiedAt
        ? UserStatus.ACTIVE
        : UserStatus.PENDING_VERIFICATION,
    );
    return this.view(await this.users.findById(id));
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const user = await this.users.findById(id);
    if (user.status === UserStatus.CLOSED) {
      throw new BadRequestException('This account is closed');
    }
    const { phone, ...names } = dto;
    const fields: { firstName?: string; lastName?: string } = {};
    if (names.firstName !== undefined)
      fields.firstName = names.firstName.trim();
    if (names.lastName !== undefined) fields.lastName = names.lastName.trim();
    if (Object.keys(fields).length) {
      await this.users.updateProfileFields(id, fields);
    }
    if (phone !== undefined) {
      let normalized: string;
      try {
        normalized = normalizeNigerianPhone(phone);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      if (normalized !== user.phone) {
        const taken = await this.users.findByPhone(normalized);
        if (taken && taken.id !== id) {
          throw new ConflictException(
            'That phone number belongs to another account',
          );
        }
        await this.users.setPhoneUnverified(id, normalized);
      }
    }
    return this.view(await this.users.findById(id));
  }

  async revokeSessions(id: string) {
    await this.users.findById(id);
    await this.endAllSessions(id);
    return { revoked: true };
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.sessions.revoke(sessionId, userId);
    await this.tokens.revokeSession(sessionId);
    return { revoked: true };
  }

  // Terminal. The console checks the wallet is empty (that data lives in the
  // payment service) before calling this; auth only enforces account state.
  async close(id: string, actorEmail?: string) {
    const user = await this.users.findById(id);
    if (user.status === UserStatus.CLOSED) return this.view(user);
    // The email is anonymized below, so keep what the goodbye email needs.
    const { email, firstName } = user;
    await this.endAllSessions(id);
    await this.dataSource.query(
      `DELETE FROM trusted_devices WHERE user_id = $1`,
      [id],
    );
    await this.dataSource.query(
      `DELETE FROM pending_logins WHERE user_id = $1`,
      [id],
    );
    await this.users.markClosed(id, `closed+${id}@closed.fiam.invalid`);
    // Only a customer who asked to leave gets a goodbye; a closure staff
    // initiated on their own is not announced here.
    if (await this.deletion.completeForUser(id, actorEmail)) {
      this.notifications.requestEmail(email, 'account-closed', { firstName });
    }
    return this.view(await this.users.findById(id));
  }

  // --- Tier-upgrade (KYC) review ---

  async approveTierUpgrade(id: string) {
    const user = await this.users.findById(id);
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Only an active account can be upgraded');
    }
    if (user.tierUpgradeStatus !== TierUpgradeStatus.UNDER_REVIEW) {
      throw new ConflictException('This upgrade is not awaiting review');
    }
    // The submit step already required these; re-check so an approval can
    // never rest on data that has since gone missing.
    const uploaded = new Set(
      (await this.docs.findBy({ userId: id })).map((d) => d.docType),
    );
    const missing = REQUIRED_DOC_TYPES.filter((t) => !uploaded.has(t));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required documents: ${missing.join(', ')}`,
      );
    }
    if (!user.ninVerifiedAt) {
      throw new BadRequestException('NIN has not been verified');
    }
    if (
      !(await this.users.decideTierUpgrade(
        id,
        TierUpgradeStatus.APPROVED,
        null,
      ))
    ) {
      throw new ConflictException(
        'This upgrade was just decided by someone else',
      );
    }
    this.notifications.requestEmail(user.email, 'kyc-tier-approved', {
      firstName: user.firstName,
      tier: '3',
    });
    this.notifications.requestPush(id, PushTemplate.KYC_APPROVED);
    return this.reviewView(await this.users.findById(id));
  }

  async rejectTierUpgrade(id: string, rawReason: string) {
    // The customer is shown this verbatim, so a rejection can't be blank.
    const reason = rawReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException(
        'A reason is required to reject an upgrade',
      );
    }
    const user = await this.users.findById(id);
    if (user.tierUpgradeStatus !== TierUpgradeStatus.UNDER_REVIEW) {
      throw new ConflictException('This upgrade is not awaiting review');
    }
    if (
      !(await this.users.decideTierUpgrade(
        id,
        TierUpgradeStatus.REJECTED,
        reason,
      ))
    ) {
      throw new ConflictException(
        'This upgrade was just decided by someone else',
      );
    }
    this.notifications.requestEmail(user.email, 'kyc-tier-rejected', {
      firstName: user.firstName,
      reason,
    });
    this.notifications.requestPush(id, PushTemplate.KYC_REJECTED);
    return this.reviewView(await this.users.findById(id));
  }

  private reviewView(u: User) {
    return {
      id: u.id,
      tier: u.tier,
      tierUpgradeStatus: u.tierUpgradeStatus,
      decidedAt: u.tierUpgradeDecidedAt,
    };
  }

  // The stored file for one of this customer's KYC documents.
  async kycDocumentFile(userId: string, docId: string) {
    const doc = await this.docs.findOneBy({ id: docId, userId });
    if (!doc) throw new NotFoundException('Document not found');
    return {
      stream: await this.storage.getObject(doc.objectKey),
      mimeType: doc.mimeType,
      filename: doc.originalFilename,
    };
  }
}
