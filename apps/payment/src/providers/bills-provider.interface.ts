import Decimal from 'decimal.js';

export interface ProviderBiller {
  id: string;
  name: string;
  division: string;
  product: string;
  category: string;
  // Extra charge the provider applies on top of the bill amount; null when
  // the biller has none.
  convenienceFee: string | null;
}

export interface ProviderBillItem {
  // Feeds `paymentItem` on validate/pay.
  paymentCode: string;
  name: string;
  // Only meaningful when isAmountFixed.
  amount: string | null;
  isAmountFixed: boolean;
}

// `valid: false` means the provider says the number isn't recognised. `name`
// and `address` are the account holder's details when the biller returns them.
export interface ProviderCustomerValidation {
  valid: boolean;
  name: string | null;
  address: string | null;
}

export interface ProviderBillPayInput {
  customerId: string;
  amount: Decimal;
  biller: Pick<ProviderBiller, 'id' | 'division' | 'product'>;
  paymentItem: string;
  reference: string;
  phoneNumber?: string | null;
}

// FAILED is safe to refund (provider says "reversal required"); REQUERY means
// the answer is unknown or still pending and must be re-verified, never
// guessed — same contract as TransferOutcome.
export type BillOutcome = 'SUCCESSFUL' | 'FAILED' | 'REQUERY';

export interface ProviderBillResult {
  outcome: BillOutcome;
  providerStatusCode: string | null;
  // Utility token / PIN, when the provider returns one.
  token: string | null;
  rawPayload: Record<string, unknown> | null;
}

export interface BillsProvider {
  listBillCategories(): Promise<string[]>;
  listBillers(category?: string): Promise<ProviderBiller[]>;
  listBillItems(
    biller: Pick<ProviderBiller, 'id' | 'division' | 'product'>,
  ): Promise<ProviderBillItem[]>;
  validateBillCustomer(input: {
    customerId: string;
    biller: Pick<ProviderBiller, 'id' | 'division'>;
    paymentItem: string;
  }): Promise<ProviderCustomerValidation>;
  payBill(input: ProviderBillPayInput): Promise<ProviderBillResult>;
  queryBillStatus(reference: string): Promise<ProviderBillResult>;
}
