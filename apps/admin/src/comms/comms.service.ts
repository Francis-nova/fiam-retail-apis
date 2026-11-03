import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { BROADCAST_QUEUE } from './comms.processor';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { Broadcast } from './entities/broadcast.entity';

@Injectable()
export class CommsService {
  constructor(
    @InjectRepository(Broadcast) private readonly repo: Repository<Broadcast>,
    @InjectQueue(BROADCAST_QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateBroadcastDto,
    ctx: { actor: AuthenticatedStaff; ip: string | null },
  ) {
    const broadcast = await this.repo.save(
      this.repo.create({
        channels: dto.channels,
        title: dto.title,
        body: dto.body,
        customerIds: dto.customerIds ?? null,
        createdBy: ctx.actor.staffId,
      }),
    );
    await this.audit.record({
      staffId: ctx.actor.staffId,
      staffEmail: ctx.actor.email,
      action: 'broadcast.created',
      resourceType: 'broadcast',
      resourceId: broadcast.id,
      metadata: {
        channels: dto.channels,
        title: dto.title,
        audience: dto.customerIds ? dto.customerIds.length : 'all',
      },
      ip: ctx.ip,
    });
    await this.queue.add(
      'send',
      { broadcastId: broadcast.id },
      { jobId: broadcast.id, attempts: 1, removeOnComplete: true },
    );
    return broadcast;
  }

  async list(page: number, pageSize: number) {
    const [items, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async get(id: string) {
    const b = await this.repo.findOneBy({ id });
    if (!b) throw new NotFoundException('Broadcast not found');
    return b;
  }
}
