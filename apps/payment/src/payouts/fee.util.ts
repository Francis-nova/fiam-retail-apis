import Decimal from 'decimal.js';

// Standard Nigerian NIP tiered transfer-fee schedule (CBN's own bank-transfer
// bands), applied uniformly regardless of destination bank — "current bank
// rate" for now, ahead of any provider-specific fee lookup.
const TIER_1_MAX = new Decimal(5_000); // <= ₦5,000
const TIER_2_MAX = new Decimal(50_000); // <= ₦50,000

const TIER_1_FEE = new Decimal(10); // ₦10
const TIER_2_FEE = new Decimal(25); // ₦25
const TIER_3_FEE = new Decimal(50); // ₦50

export function calculateTransferFee(amount: Decimal): Decimal {
  if (amount.lessThanOrEqualTo(TIER_1_MAX)) return TIER_1_FEE;
  if (amount.lessThanOrEqualTo(TIER_2_MAX)) return TIER_2_FEE;
  return TIER_3_FEE;
}

export const FREE_PAYOUTS_PER_DAY = 2;
const VAT_RATE = new Decimal('0.075'); // 7.5% VAT on the fee

// Fee plus 7.5% VAT on it, rounded to kobo.
export function withVat(fee: Decimal): Decimal {
  return fee.plus(fee.times(VAT_RATE)).toDecimalPlaces(2);
}

// Government levy (Nigeria Tax Act 2025, in force 1 Jan 2026): a flat ₦50 on
// electronic transfers of ₦10,000 or more, now borne by the sender. It is not
// our fee and no free-payout rule waives it.
const STAMP_DUTY = new Decimal(50);
const STAMP_DUTY_THRESHOLD = new Decimal(10_000);

export function stampDuty(amount: Decimal): Decimal {
  return amount.greaterThanOrEqualTo(STAMP_DUTY_THRESHOLD)
    ? STAMP_DUTY
    : new Decimal(0);
}
