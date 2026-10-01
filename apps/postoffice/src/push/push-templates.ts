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
  }
}
