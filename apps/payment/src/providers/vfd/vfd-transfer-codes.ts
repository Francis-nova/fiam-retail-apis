export type VfdOutcomeCategory = 'SUCCESSFUL' | 'FAILED' | 'PENDING';

export interface VfdCodeClassification {
  category: VfdOutcomeCategory;
  tsqRequired: boolean;
  description: string;
}

// The /transfer endpoint's own synchronous top-level `status` field. This is
// a DIFFERENT code space from the `transactionStatus` field below, even
// though VFD reuses overlapping numeric values with different meanings —
// e.g. "02" here means "Signature Mismatch" (a pre-flight rejection, our own
// bug), while "02" in the TSQ table means "Status Unknown, awaiting
// settlement" (a real pending state). Only mapped for the codes VFD's docs
// actually show a /transfer response for; anything else defaults to
// PENDING/tsqRequired so we verify via TSQ instead of guessing.
const TRANSFER_RESPONSE_CODES: Record<string, VfdCodeClassification> = {
  '00': {
    category: 'SUCCESSFUL',
    tsqRequired: false,
    description: 'Successful Transfer',
  },
  '99': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Failed Transaction',
  },
  '02': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Signature Mismatch',
  },
  '98': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid uniqueSenderAccountId / Transaction Exists',
  },
};

const UNKNOWN_TRANSFER_RESPONSE: VfdCodeClassification = {
  category: 'PENDING',
  tsqRequired: true,
  description:
    'Unrecognized or missing /transfer response status — verify via TSQ',
};

export function classifyVfdTransferResponse(
  status: string | null | undefined,
): VfdCodeClassification {
  if (!status) return UNKNOWN_TRANSFER_RESPONSE;
  return TRANSFER_RESPONSE_CODES[status] ?? UNKNOWN_TRANSFER_RESPONSE;
}

// TSQ's `transactionStatus` field — verbatim from VFD's "Codes Description
// For Transfer API" table
// (https://vbaas-docs.vfdtech.ng/docs/wallets-api/Products/wallets-api#codes-description-for-transfer-api).
const TRANSACTION_STATUS_CODES: Record<string, VfdCodeClassification> = {
  '00': {
    category: 'SUCCESSFUL',
    tsqRequired: false,
    description: 'Approved or Completed Successfully',
  },
  '01': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Status Unknown, Please wait for Settlement Report',
  },
  '02': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Status Unknown, Please wait for Settlement Report',
  },
  '03': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Sender',
  },
  '05': { category: 'FAILED', tsqRequired: false, description: 'Do not Honor' },
  '06': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Dormant Account',
  },
  '07': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Account',
  },
  '08': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Account Name Mismatch',
  },
  '09': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Request Processing in Progress',
  },
  '12': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Transaction',
  },
  '13': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Amount',
  },
  '14': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Batch Number',
  },
  '15': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Session or Record ID',
  },
  '16': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Unknown Bank Code',
  },
  '17': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Invalid Channel',
  },
  '18': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Wrong Method Call',
  },
  '21': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Failed with reversal',
  },
  '25': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Unable to Locate Record',
  },
  '26': {
    category: 'SUCCESSFUL',
    tsqRequired: false,
    description: 'Successful',
  },
  '30': { category: 'FAILED', tsqRequired: false, description: 'Format Error' },
  '34': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Suspected Fraud',
  },
  '35': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Contact Sending Bank',
  },
  '51': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'No Sufficient Funds',
  },
  '57': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Transaction not Permitted to Sender',
  },
  '58': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Transaction not Permitted on Channel',
  },
  '61': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Transaction Limit Exceeded',
  },
  '63': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Security Violation',
  },
  '65': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Exceeds Withdrawal Frequency',
  },
  '68': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Response Received Too Late',
  },
  '69': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Unsuccessful Account/Amount Block',
  },
  '70': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Unsuccessful Account/Amount Block',
  },
  '71': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Empty Mandate Reference Number',
  },
  '81': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Transaction Failed',
  },
  '91': {
    category: 'FAILED',
    tsqRequired: true,
    description: 'Beneficiary Bank Not Available',
  },
  '92': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Routing Error',
  },
  '94': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Duplicate Transaction',
  },
  '96': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'System Malfunction',
  },
  '97': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Timeout Waiting for response from Destination',
  },
  '98': {
    category: 'FAILED',
    tsqRequired: true,
    description: 'Transaction Exists',
  },
  '99': {
    category: 'FAILED',
    tsqRequired: false,
    description: 'Transaction Failed',
  },
  '500': {
    category: 'PENDING',
    tsqRequired: true,
    description: 'Internal server error',
  },
};

const UNKNOWN_TRANSACTION_STATUS: VfdCodeClassification = {
  category: 'PENDING',
  tsqRequired: true,
  description: 'Unrecognized or missing transactionStatus — verify via TSQ',
};

export function classifyVfdTransactionStatus(
  code: string | null | undefined,
): VfdCodeClassification {
  if (!code) return UNKNOWN_TRANSACTION_STATUS;
  return TRANSACTION_STATUS_CODES[code] ?? UNKNOWN_TRANSACTION_STATUS;
}

export type VfdTransferOutcome = 'SUCCESSFUL' | 'FAILED' | 'REQUERY';

// The single decision point both call sites (the synchronous /transfer
// response and the TSQ poller) funnel through — mirrors VFD's own "Quick
// Guide" verbatim: tsqRequired always wins (go verify, don't guess),
// otherwise trust the category directly.
export function resolveVfdOutcome(
  classification: VfdCodeClassification,
): VfdTransferOutcome {
  if (classification.tsqRequired) return 'REQUERY';
  if (classification.category === 'SUCCESSFUL') return 'SUCCESSFUL';
  if (classification.category === 'FAILED') return 'FAILED';
  return 'REQUERY';
}
