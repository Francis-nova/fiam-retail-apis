export interface VfdTokenResponse {
  status?: string;
  message?: string;
  data?: {
    access_token?: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
  };
}

export interface VfdCreateAccountResponse {
  status?: string;
  message?: string;
  data?: {
    firstname?: string;
    middlename?: string;
    lastname?: string;
    currentTier?: string;
    accountNo?: string;
    [key: string]: unknown;
  };
}

export interface VfdBankListResponse {
  status?: string;
  message?: string;
  // Shape unconfirmed — see normalizeVfdBankList in vfd-bank-list.util.ts.
  data?: unknown;
}

export interface VfdAccountEnquiryResponse {
  status?: string;
  message?: string;
  data?: {
    accountNo?: string;
    accountBalance?: string;
    accountId?: string;
    client?: string;
    clientId?: string;
    savingsProductName?: string;
    // Not shown in VFD's own two sample responses for this endpoint, but the
    // /transfer field table points fromBvn at "(a) bvn" from this response —
    // read defensively.
    bvn?: string;
    [key: string]: unknown;
  };
}

export interface VfdRecipientResponse {
  status?: string;
  message?: string;
  data?: {
    name?: string;
    clientId?: string;
    bvn?: string;
    account?: { number?: string; id?: string };
    status?: string;
    currency?: string;
    bank?: string;
  };
}

export interface VfdTransferResponse {
  status?: string;
  message?: string;
  data?: {
    txnId?: string;
    sessionId?: string;
    reference?: string;
  };
}

export interface VfdTransactionStatusResponse {
  status?: string;
  message?: string;
  data?: {
    TxnId?: string;
    amount?: string;
    accountNo?: string;
    fromAccountNo?: string;
    transactionStatus?: string;
    transactionDate?: string;
    toBank?: string;
    fromBank?: string;
    sessionId?: string;
    bankTransactionId?: string;
    transactionType?: string;
  };
}
