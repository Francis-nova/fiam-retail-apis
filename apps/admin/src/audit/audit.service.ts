import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  staffId?: string | null;
  staffEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  // Awaited by callers for state-changing actions (so a failed audit write
  // fails the action's response loudly); for read-tracking use `recordSafe`.
  async record(entry: AuditEntry): Promise<void> {
    await this.repo.save(
      this.repo.create({
        staffId: entry.staffId ?? null,
        staffEmail: entry.staffEmail ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
      }),
    );
  }

  async recordSafe(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${String(err)}`);
    }
  }

  async list(filter: {
    staffId?: string;
    action?: string;
    resourceId?: string;
    page: number;
    pageSize: number;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC');
    if (filter.staffId) qb.andWhere('a.staffId = :s', { s: filter.staffId });
    if (filter.action) qb.andWhere('a.action = :act', { act: filter.action });
    if (filter.resourceId)
      qb.andWhere('a.resourceId = :r', { r: filter.resourceId });
    const [items, total] = await qb
      .skip((filter.page - 1) * filter.pageSize)
      .take(filter.pageSize)
      .getManyAndCount();
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }
}
