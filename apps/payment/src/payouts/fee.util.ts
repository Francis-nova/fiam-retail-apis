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
