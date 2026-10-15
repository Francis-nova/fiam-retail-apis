import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ProviderBillItem,
  ProviderBiller,
} from '../providers/bills-provider.interface';

// Per-biller requirements VFD documents for its bills API
// (https://vbaas-docs.vfdtech.ng/docs/wallets-api/Products/bills-payment-api#35-pay-bills).
// Checked before the wallet is debited, so a purchase VFD would reject never
// reaches it (and the customer never sees a debit-then-refund).

// "The minimum vending amount for IBEDC (Band A) is NGN 5,000."
const IBEDC_BAND_A_MIN = new Decimal(5000);

const matches = (
  biller: Pick<ProviderBiller, 'id' | 'name'>,
  pattern: RegExp,
) => pattern.test(biller.id) || pattern.test(biller.name);

export function assertBillerRules(input: {
  biller: Pick<ProviderBiller, 'id' | 'name'>;
  item: Pick<ProviderBillItem, 'name'>;
  amount: Decimal;
  phoneNumber?: string | null;
}): void {
  const { biller, item, amount, phoneNumber } = input;

  // "phoneNumber ... mandatory for IKEDC."
  if (matches(biller, /ikedc|ikeja\s*electric/i) && !phoneNumber?.trim()) {
    throw new BadRequestException(
      `A phone number is required to pay ${biller.name}`,
    );
  }

  if (
    matches(biller, /ibedc|ibadan\s*electric/i) &&
    /band\s*a\b/i.test(item.name) &&
    amount.lessThan(IBEDC_BAND_A_MIN)
  ) {
    throw new BadRequestException(
      `The minimum amount for ${biller.name} (Band A) is ₦${IBEDC_BAND_A_MIN.toFixed(2)}`,
    );
  }
}
