import { PushTemplate } from '@app/common';
import type { PushPayload } from './push-provider.interface';

export function isPushTemplate(value: string): value is PushTemplate {
  return Object.values<string>(PushTemplate).includes(value);
}

function naira(raw: string | undefined): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return '₦0.00';
  return `₦${value.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Postoffice owns the wording — producers only send the template key and
// raw data, same as for email.
export function renderPush(
  template: PushTemplate,
  data: Record<string, string>,
): PushPayload {
  const amount = naira(data.amount);
  const tapData = data.transactionId
    ? { type: 'transaction', transactionId: data.transactionId }
    : undefined;

  switch (template) {
    case PushTemplate.MONEY_RECEIVED:
      return {
        title: 'Money received',
        body: `${amount} has been added to your Fiam wallet.`,
        data: tapData,
      };
    case PushTemplate.PAYOUT_SUCCESSFUL:
      return {
        title: 'Transfer successful',
        body: `Your transfer of ${amount} was successful.`,
        data: tapData,
      };
    case PushTemplate.PAYOUT_FAILED:
      return {
        title: 'Transfer failed',
        body: `Your transfer of ${amount} didn't go through. The money has been returned to your wallet.`,
        data: tapData,
      };
    case PushTemplate.ACCOUNT_CREDITED:
      return {
        title: 'Account credited',
        body: `${amount} was added to your Fiam wallet.`,
        data: tapData,
      };
    case PushTemplate.ACCOUNT_DEBITED:
      return {
        title: 'Account debited',
        body: `${amount} was debited from your Fiam wallet. Open the app for details, or contact support if you don't recognise this.`,
        data: tapData,
      };
    case PushTemplate.DELETION_REJECTED:
      return {
        title: 'Account deletion request',
        body: "We couldn't process your request to delete your account. Open the app to see why.",
        data: { type: 'account-deletion' },
      };
    case PushTemplate.KYC_APPROVED:
      return {
        title: "You're verified",
        body: 'Your account has been upgraded to Tier 3. Higher limits are now available.',
        data: { type: 'kyc' },
      };
    case PushTemplate.KYC_REJECTED:
      return {
        title: 'Update needed on your verification',
        body: "We couldn't approve your upgrade. Open the app to see why and submit again.",
        data: { type: 'kyc' },
      };
  }
}
