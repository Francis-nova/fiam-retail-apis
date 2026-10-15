import Decimal from 'decimal.js';
import {
  BillType,
  billTypeFromCategory,
} from '../transactions/entities/transaction.entity';

// Airtime and data carry no platform fee; everything else (electricity,
// cable TV, internet, betting…) pays the configured flat fee.
const FEE_FREE_TYPES = new Set<BillType>([BillType.AIRTIME, BillType.DATA]);

export interface BillFees {
  // The provider's own convenience fee, when the biller has one.
  convenienceFee: Decimal;
  // Our flat platform fee for this kind of bill.
  serviceFee: Decimal;
  // What the customer pays on top of the bill amount.
  total: Decimal;
}

// The single place a bill's fee is decided. It only ever sees the provider's
// biller record (looked up server-side) and our own config — never anything
// the client sent.
export function calculateBillFees(
  biller: { category: string; convenienceFee: string | null },
  configuredServiceFee: string,
): BillFees {
  const convenienceFee = new Decimal(biller.convenienceFee ?? 0);
  const serviceFee = FEE_FREE_TYPES.has(billTypeFromCategory(biller.category))
    ? new Decimal(0)
    : new Decimal(configuredServiceFee);
  return {
    convenienceFee,
    serviceFee,
    total: convenienceFee.plus(serviceFee),
  };
}
