import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NOTIFICATION_REQUESTED_PATTERN,
  NotificationChannel,
} from '@app/common';
import { AdminConfig } from '../config/configuration';
import {
  StaffRole,
  StaffStatus,
  StaffUser,
} from '../staff/entities/staff-user.entity';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-client.token';
import type { AuditEntry } from './audit.service';

// The audited actions worth interrupting a super admin for: anything that
// changes who can get in, moves money, or ends a customer's account.
export const ALERT_ACTIONS: Record<string, string> = {
  'staff.created': 'Staff account created',
  'staff.updated': 'Staff account role or status changed',
  'staff.deleted': 'Staff account deleted',
  'staff.password_reset': 'Staff password reset',
  'staff.mfa_reset': 'Staff two-factor reset',
  'auth.account_locked': 'Staff account locked after failed sign-ins',
  'auth.mfa_disabled': 'Staff turned off two-factor',
  'customer.closed': 'Customer account closed',
  'posting.approved': 'Manual posting approved',
  'posting.failed': 'Manual posting failed',
};

const lagos = () =>
  new Date().toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * Emails every active super admin when a high-risk action is audited.
 * Best-effort and fire-and-forget: it never throws, and it is off when no
 * RABBITMQ_URL is configured (local development).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(POSTOFFICE_NOTIFICATION_CLIENT)
    private readonly client: ClientProxy,
    @InjectRepository(StaffUser) private readonly staff: Repository<StaffUser>,
    private readonly config: ConfigService<AdminConfig, true>,
  ) {}

  get enabled(): boolean {
    return !!this.config.get('rabbitmq', { infer: true }).url;
  }

  async notify(entry: AuditEntry): Promise<void> {
    const title = ALERT_ACTIONS[entry.action];
    if (!title || !this.enabled) return;
    try {
      const admins = await this.staff.find({
        where: { role: StaffRole.SUPER_ADMIN, status: StaffStatus.ACTIVE },
        select: { email: true, fullName: true },
      });
      const target =
        [entry.resourceType, entry.resourceId].filter(Boolean).join(' ') || '—';
      for (const admin of admins) {
        this.client.emit(NOTIFICATION_REQUESTED_PATTERN, {
          messageId: randomUUID(),
          channel: NotificationChannel.EMAIL,
          recipient: admin.email,
          template: 'staff-alert',
          data: {
            firstName: admin.fullName.split(' ')[0] || 'there',
            title,
            actor: entry.staffEmail ?? 'System',
            target,
            occurredAt: lagos(),
            ipAddress: entry.ip ?? 'Unknown',
          },
          requestedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(`Could not send staff alert: ${String(err)}`);
    }
  }
}
