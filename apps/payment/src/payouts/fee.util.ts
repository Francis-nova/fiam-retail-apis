// Standard Nigerian NIP tiered transfer-fee schedule (CBN's own bank-transfer
// bands), applied uniformly regardless of destination bank — "current bank
// rate" for now, ahead of any provider-specific fee lookup.
const TIER_1_MAX_MINOR = 5_000_00n; // <= ₦5,000
const TIER_2_MAX_MINOR = 50_000_00n; // <= ₦50,000

const TIER_1_FEE_MINOR = 10_00n; // ₦10
const TIER_2_FEE_MINOR = 25_00n; // ₦25
const TIER_3_FEE_MINOR = 50_00n; // ₦50

export function calculateTransferFeeMinor(amountMinor: bigint): bigint {
  if (amountMinor <= TIER_1_MAX_MINOR) return TIER_1_FEE_MINOR;
  if (amountMinor <= TIER_2_MAX_MINOR) return TIER_2_FEE_MINOR;
  return TIER_3_FEE_MINOR;
}
