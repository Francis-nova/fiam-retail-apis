import Decimal from 'decimal.js';
import { PaymentProviderKey } from '../wallets/entities/address.entity';

export interface ProviderAccountApplicant {
  bvn: string;
  dateOfBirth: string; // ISO 'YYYY-MM-DD'; adapters convert to their own format
  firstName: string;
  lastName: string;
}

export interface ProviderAccount {
  provider: PaymentProviderKey;
  accountNumber: string;
  accountName: string | null;
  providerTierRaw: string | null;
  metadata: Record<string, unknown>;
}

export interface ProviderBank {
  code: string;
  name: string;
}

export interface ProviderAccountDetails {
  accountNumber: string;
  accountId: string;
  clientId: string;
  clientName: string;
  bvn: string | null;
}

export type ProviderTransferType = 'intra' | 'inter';

export interface ProviderTransferRecipientInput {
  accountNumber: string;
  bankCode: string;
  transferType: ProviderTransferType;
}

export interface ProviderTransferRecipient {
  name: string | null;
  clientId: string | null;
  bvn: string | null;
  accountNumber: string;
  accountId: string | null;
  bankName: string | null;
  currency: string | null;
}

export interface ProviderInitiateTransferInput {
  // The account funds are actually disbursed from — for a pool
  // implementation (VFD), this is the pool account, not the customer's.
  from: ProviderAccountDetails;
  // Provider-side id of the customer's own (sub-)account, so the receiving
  // bank/recipient can see who the real sender is. Null when not applicable.
  senderAccountId?: string | null;
  to: ProviderTransferRecipient;
  bankCode: string;
  transferType: ProviderTransferType;
  amount: Decimal;
  reference: string;
  narration: string;
}

// A payout resolves to exactly one of these outcomes, regardless of
// provider: definitively succeeded, definitively failed (safe to reverse
// our own ledger hold), definitively failed but the provider says NOT to
// reverse (HOLD — funds stay held for manual review), or unresolved (must
// be re-verified — never assumed either way).
export type TransferOutcome = 'SUCCESSFUL' | 'FAILED' | 'HOLD' | 'REQUERY';

export interface ProviderTransferResult {
  outcome: TransferOutcome;
  providerReference: string;
  externalId: string | null;
  providerStatusCode: string | null;
  rawPayload: Record<string, unknown> | null;
}

export interface PaymentProvider {
  readonly key: PaymentProviderKey;
  createAccount(applicant: ProviderAccountApplicant): Promise<ProviderAccount>;
  listBanks(): Promise<ProviderBank[]>;
  // Whether a payout to this destination bank stays inside the provider
  // (intra) or goes out to another bank (inter). Provider-specific: for VFD,
  // destination bank code 999999 is VFD-to-VFD.
  resolveTransferType(bankCode: string): ProviderTransferType;
  getAccountDetails(accountNumber?: string): Promise<ProviderAccountDetails>;
  lookupTransferRecipient(
    input: ProviderTransferRecipientInput,
  ): Promise<ProviderTransferRecipient>;
  initiateTransfer(
    input: ProviderInitiateTransferInput,
  ): Promise<ProviderTransferResult>;
  queryTransferStatus(reference: string): Promise<ProviderTransferResult>;
}
