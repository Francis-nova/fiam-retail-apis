import { Injectable } from '@nestjs/common';
import { PushTemplate } from '@app/common';
import { NotificationPublisher } from './notification.publisher';
import type { SecretKind } from '../users/users.service';

interface AlertUser {
  id: string;
  email: string;
  firstName: string;
}

function lagosNow(): string {
  return new Date().toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Tells the customer (email + push to their registered devices) when someone
// is trying to get into their account. Fire-and-forget like every other
// notification: an alert must never fail or slow the request that caused it.
@Injectable()
export class SecurityAlertsService {
  constructor(private readonly notifications: NotificationPublisher) {}

  // Sent once, when the Nth wrong guess locks the password or PIN.
  lockout(user: AlertUser, kind: SecretKind, ipAddress?: string): void {
    const what = kind === 'pin' ? 'transaction PIN' : 'password';
    this.notifications.requestEmail(user.email, 'security-alert', {
      firstName: user.firstName,
      what,
      occurredAt: lagosNow(),
      ipAddress: ipAddress ?? 'Unknown',
    });
    this.notifications.requestPush(user.id, PushTemplate.SECURITY_LOCKOUT, {
      kind,
    });
  }

  // Correct password, but from a device we haven't seen — the PIN challenge
  // still stands in the way, but the owner should know it was attempted.
  newDevice(
    user: AlertUser,
    meta: { deviceName?: string; ipAddress?: string },
  ): void {
    this.notifications.requestEmail(user.email, 'new-device-login', {
      firstName: user.firstName,
      deviceName: meta.deviceName ?? 'Unknown device',
      occurredAt: lagosNow(),
      ipAddress: meta.ipAddress ?? 'Unknown',
    });
    this.notifications.requestPush(user.id, PushTemplate.SECURITY_NEW_DEVICE);
  }
}
