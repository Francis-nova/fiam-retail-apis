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

export interface VfdBankListData {
  bank?: {
    id: number;
    code: string;
    name: string;
    logo?: string;
    created?: string;
  }[];
}

export interface VfdBankListResponse {
  status?: string;
  message?: string;
  data?: VfdBankListData;
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

// Bills payment API (…/vtech-bills/api/v2/billspaymentstore).
export interface VfdBillCategoryResponse {
  status?: string;
  message?: string;
  data?: { category?: string }[];
}

export interface VfdBillerListResponse {
  status?: string;
  message?: string;
  data?: {
    id?: string;
    name?: string;
    division?: string;
    product?: string;
    category?: string;
    convenienceFee?: string | number | null;
  }[];
}

export interface VfdBillerItemsResponse {
  status?: string;
  message?: string;
  data?: {
    paymentitems?: {
      paymentitemname?: string;
      paymentCode?: string;
      amount?: string | number | null;
      isAmountFixed?: string | boolean | null;
      itemFee?: string | number | null;
      [key: string]: unknown;
    }[];
  };
}

export interface VfdBillPayResponse {
  status?: string;
  message?: string;
  data?: { reference?: string; token?: string };
}

export interface VfdBillStatusResponse {
  status?: string;
  message?: string;
  data?: {
    transactionStatus?: string;
    amount?: string;
    token?: string;
  };
}
