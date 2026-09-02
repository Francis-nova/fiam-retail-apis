// Shared by every producer (auth, payment, ...) and apps/postoffice
// (consumer) so the queue name, event pattern, and payload shape can't drift
// independently between services. Postoffice has no REST API of its own —
// this queue is the only way another service reaches it.
export const POSTOFFICE_NOTIFICATION_QUEUE =
  'postoffice.notification_requested';
export const NOTIFICATION_REQUESTED_PATTERN = 'notification.requested';

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

export interface NotificationRequestedMessage {
  messageId: string;
  channel: NotificationChannel;
  // Email address, phone number (E.164), or push device token, depending
  // on `channel`.
  recipient: string;
  // Named template key (e.g. 'otp-code', 'transaction-receipt') — postoffice
  // owns the copy/layout per channel, callers only supply the key and data.
  template: string;
  data: Record<string, string>;
  requestedAt: string; // ISO timestamp
}
