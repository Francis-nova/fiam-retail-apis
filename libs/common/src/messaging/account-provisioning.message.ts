import { CurrencyCode } from '../payments/currency.enum';

// Shared by apps/auth (producer) and apps/payment (consumer) so the queue
// name, event pattern, and payload shape can't drift independently between
// the two services.
export const PAYMENT_ACCOUNT_PROVISIONING_QUEUE =
  'payment.account_provisioning_requested';
export const ACCOUNT_PROVISIONING_REQUESTED_PATTERN =
  'account.provisioning.requested';

export interface AccountProvisioningRequestedMessage {
  messageId: string;
  userId: string;
  currency: CurrencyCode;
  bvn: string;
  dateOfBirth: string; // ISO 'YYYY-MM-DD'
  firstName: string;
  lastName: string;
  requestedAt: string; // ISO timestamp
}
