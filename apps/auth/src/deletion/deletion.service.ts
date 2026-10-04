import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushTemplate } from '@app/common';
import { PasswordService } from '../credentials/password.service';
import { NotificationPublisher } from '../messaging/notification.publisher';
import { UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  AccountDeletionRequest,
  DeletionRequestStatus,
} from './entities/account-deletion-request.entity';

const UNIQUE_VIOLATION = '23505';

// Customer-initiated account deletion. The customer can ask and withdraw;
// only staff (via the admin console) can decide. Approval is not handled
// here — it is the account-closure flow, which calls completeForUser().
@Injectable()
export class DeletionService {
  constructor(
    @InjectRepository(AccountDeletionRequest)
    private readonly repo: Repository<AccountDeletionRequest>,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationPublisher,
  ) {}

  private view(r: AccountDeletionRequest | null) {
    if (!r) return { status: 'NONE' as const };
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      requestedAt: r.createdAt,
      decidedAt: r.decidedAt,
      // Only a rejection's note is meant for the customer.
      rejectionReason:
        r.status === DeletionRequestStatus.REJECTED ? r.decisionNote : null,
    };
  }

  // The latest request: an open one if there is one, otherwise how the last
  // one ended (so a rejection reason stays visible).
  async current(userId: string) {
    const latest = await this.repo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return this.view(latest);
  }

  async request(userId: string, password: string, reason?: string) {
    const user = await this.users.findById(userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('This account cannot request deletion');
    }
    const passwordOk = await this.users.guardedVerify(userId, 'password', () =>
      this.passwords.verify(user.passwordHash, password),
    );
    if (!passwordOk) {
      // 400, not 401: a wrong password here must not sign the customer out.
      throw new BadRequestException('Incorrect password');
    }
    const open = await this.repo.findOneBy({
      userId,
      status: DeletionRequestStatus.PENDING,
    });
    if (open) {
      throw new ConflictException(
        'You already have a deletion request pending',
      );
    }
    let saved: AccountDeletionRequest;
    try {
      saved = await this.repo.save(
        this.repo.create({ userId, reason: reason?.trim() || null }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'You already have a deletion request pending',
        );
      }
      throw err;
    }
    this.notifications.requestEmail(user.email, 'deletion-request-received', {
      firstName: user.firstName,
    });
    return this.view(saved);
  }

  async cancel(userId: string) {
    const result = await this.repo
      .createQueryBuilder()
      .update(AccountDeletionRequest)
      .set({
        status: DeletionRequestStatus.CANCELLED,
        decidedAt: new Date(),
      })
      .where('user_id = :userId AND status = :pending', {
        userId,
        pending: DeletionRequestStatus.PENDING,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new NotFoundException('You have no pending deletion request');
    }
    return this.current(userId);
  }

  // --- Called by the admin console over /internal ---

  async reject(id: string, reason: string, actorEmail?: string) {
    const note = reason.trim();
    if (note.length < 3) {
      throw new BadRequestException('A reason is required to reject a request');
    }
    const request = await this.repo.findOneBy({ id });
    if (!request) throw new NotFoundException('Request not found');
    const result = await this.repo
      .createQueryBuilder()
      .update(AccountDeletionRequest)
      .set({
        status: DeletionRequestStatus.REJECTED,
        decidedAt: new Date(),
        decidedByEmail: actorEmail ?? null,
        decisionNote: note,
      })
      .where('id = :id AND status = :pending', {
        id,
        pending: DeletionRequestStatus.PENDING,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new ConflictException('This request was already decided');
    }
    const user = await this.users.findById(request.userId);
    this.notifications.requestEmail(user.email, 'deletion-request-rejected', {
      firstName: user.firstName,
      reason: note,
    });
    this.notifications.requestPush(user.id, PushTemplate.DELETION_REJECTED);
    return { id, status: DeletionRequestStatus.REJECTED };
  }

  // Closing the account fulfils any open request. Returns whether there was
  // one, so the closure flow knows to send the customer a goodbye email.
  async completeForUser(userId: string, actorEmail?: string): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(AccountDeletionRequest)
      .set({
        status: DeletionRequestStatus.COMPLETED,
        decidedAt: new Date(),
        decidedByEmail: actorEmail ?? null,
      })
      .where('user_id = :userId AND status = :pending', {
        userId,
        pending: DeletionRequestStatus.PENDING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
