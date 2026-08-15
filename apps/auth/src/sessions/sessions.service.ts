import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { Session } from './entities/session.entity';

export interface CreateSessionInput {
  userId: string;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  create(input: CreateSessionInput): Promise<Session> {
    const session = this.sessionsRepo.create({
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      deviceName: input.deviceName ?? null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      lastSeenAt: new Date(),
    });
    return this.sessionsRepo.save(session);
  }

  // Atomically revokes every existing active session for this user and
  // creates the new one, serialized per-user via a Postgres advisory lock.
  // Plain sequential revoke-then-create (what login/confirmLoginPin/verifyOtp
  // used to call directly) has a real race under concurrent logins for the
  // same user: two requests can both pass the "revoke all" step before
  // either inserts its new row, leaving two sessions simultaneously active —
  // found via testing (rapid-fire concurrent logins), not by inspection.
  // The lock is scoped to the transaction and auto-released on commit.
  async createExclusive(input: CreateSessionInput): Promise<Session> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.userId,
      ]);
      await manager.update(
        Session,
        { userId: input.userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      const repo = manager.getRepository(Session);
      const session = repo.create({
        userId: input.userId,
        deviceId: input.deviceId ?? null,
        deviceName: input.deviceName ?? null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        lastSeenAt: new Date(),
      });
      return repo.save(session);
    });
  }

  listActiveForUser(userId: string): Promise<Session[]> {
    return this.sessionsRepo.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastSeenAt: 'DESC' },
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.sessionsRepo.update(sessionId, { lastSeenAt: new Date() });
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessionsRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Cannot revoke a session that is not yours');
    }
    await this.sessionsRepo.update(sessionId, { revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessionsRepo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  // Enforces "one active session per customer" — called right before a new
  // session is created so logging in on device B immediately kills whatever
  // was still active on device A.
  async revokeAllForUserExcept(
    userId: string,
    exceptSessionId: string,
  ): Promise<void> {
    await this.sessionsRepo.update(
      { userId, revokedAt: IsNull(), id: Not(exceptSessionId) },
      { revokedAt: new Date() },
    );
  }
}
