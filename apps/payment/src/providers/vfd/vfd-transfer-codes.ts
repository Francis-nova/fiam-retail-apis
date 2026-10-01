export type VfdOutcomeCategory = 'SUCCESSFUL' | 'FAILED' | 'PENDING';

// VFD's "Reversal Instruction" column:
//  - REVERSE     the transfer failed after our debit; return the customer's
//                money.
//  - NO_DEBIT    the transfer failed before VFD moved any money; the
//                customer's hold on our own ledger is still returned.
//  - NO_REVERSAL VFD instructs NOT to reverse (suspected fraud, security
//                violation, contact sending bank) — funds stay held pending
//                a manual review; never auto-refunded.
//  - NONE        successful or still pending; nothing to reverse yet.
export type VfdReversalInstruction =
  'REVERSE' | 'NO_DEBIT' | 'NO_REVERSAL' | 'NONE';

export interface VfdCodeClassification {
  category: VfdOutcomeCategory;
  tsqRequired: boolean;
  reversal: VfdReversalInstruction;
  description: string;
}

function entry(
  description: string,
  category: VfdOutcomeCategory,
  reversal: VfdReversalInstruction,
  tsqRequired: boolean,
): VfdCodeClassification {
  return { category, tsqRequired, reversal, description };
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
  '00': entry('Successful Transfer', 'SUCCESSFUL', 'NONE', false),
  '99': entry('Failed Transaction', 'FAILED', 'NO_DEBIT', false),
  '02': entry('Signature Mismatch', 'FAILED', 'NO_DEBIT', false),
  // "Invalid uniqueSenderAccountId" and "Transaction Exist" share this code.
  // The latter means a previous attempt with this reference may have gone
  // through, so verify via TSQ before returning anyone's money.
  '98': entry(
    'Invalid uniqueSenderAccountId / Transaction Exists',
    'FAILED',
    'NO_DEBIT',
    true,
  ),
  // Ambiguous by VFD's own wording ("Pending State....run tsq").
  '500': entry('Pending State — run TSQ', 'PENDING', 'NONE', true),
};

const UNKNOWN_TRANSFER_RESPONSE: VfdCodeClassification = entry(
  'Unrecognized or missing /transfer response status — verify via TSQ',
  'PENDING',
  'NONE',
  true,
);

export function classifyVfdTransferResponse(
  status: string | null | undefined,
): VfdCodeClassification {
  if (!status) return UNKNOWN_TRANSFER_RESPONSE;
  return TRANSFER_RESPONSE_CODES[status] ?? UNKNOWN_TRANSFER_RESPONSE;
}

// TSQ's `transactionStatus` field — verbatim from VFD's "Codes Description
// For Transfer API" table
// (https://vbaas-docs.vfdtech.ng/docs/wallets-api/Products/wallets-api#codes-description-for-transfer-api),
// including its Reversal Instruction and TSQ Required columns.
const TRANSACTION_STATUS_CODES: Record<string, VfdCodeClassification> = {
  '00': entry(
    'Approved or Completed Successfully',
    'SUCCESSFUL',
    'NONE',
    false,
  ),
  '01': entry(
    'Status Unknown, Please wait for Settlement Report',
    'PENDING',
    'NONE',
    true,
  ),
  '02': entry(
    'Status Unknown, Please wait for Settlement Report',
    'PENDING',
    'NONE',
    true,
  ),
  '03': entry('Invalid Sender', 'FAILED', 'REVERSE', false),
  '05': entry('Do not Honor', 'FAILED', 'REVERSE', false),
  '06': entry('Dormant Account', 'FAILED', 'REVERSE', false),
  '07': entry('Invalid Account', 'FAILED', 'REVERSE', false),
  '08': entry('Account Name Mismatch', 'FAILED', 'REVERSE', false),
  '09': entry('Request Processing in Progress', 'PENDING', 'NONE', true),
  '12': entry('Invalid Transaction', 'FAILED', 'REVERSE', false),
  '13': entry('Invalid Amount', 'FAILED', 'REVERSE', false),
  '14': entry('Invalid Batch Number', 'FAILED', 'REVERSE', false),
  '15': entry('Invalid Session or Record ID', 'FAILED', 'REVERSE', false),
  '16': entry('Unknown Bank Code', 'FAILED', 'REVERSE', false),
  '17': entry('Invalid Channel', 'FAILED', 'REVERSE', false),
  '18': entry('Wrong Method Call', 'FAILED', 'REVERSE', false),
  '21': entry('Failed with reversal', 'FAILED', 'REVERSE', false),
  '25': entry('Unable to Locate Record', 'PENDING', 'NONE', true),
  '26': entry('Successful', 'SUCCESSFUL', 'NONE', false),
  '30': entry('Format Error', 'FAILED', 'REVERSE', false),
  '34': entry('Suspected Fraud', 'FAILED', 'NO_REVERSAL', false),
  '35': entry('Contact Sending Bank', 'FAILED', 'NO_REVERSAL', false),
  '51': entry('No Sufficient Funds', 'FAILED', 'NO_DEBIT', false),
  '57': entry(
    'Transaction not Permitted to Sender',
    'FAILED',
    'REVERSE',
    false,
  ),
  '58': entry(
    'Transaction not Permitted on Channel',
    'FAILED',
    'REVERSE',
    false,
  ),
  '61': entry('Transaction Limit Exceeded', 'FAILED', 'REVERSE', false),
  '63': entry('Security Violation', 'FAILED', 'NO_REVERSAL', false),
  '65': entry('Exceeds Withdrawal Frequency', 'FAILED', 'REVERSE', false),
  '68': entry('Response Received Too Late', 'FAILED', 'REVERSE', false),
  '69': entry('Unsuccessful Account/Amount Block', 'FAILED', 'REVERSE', false),
  '70': entry('Unsuccessful Account/Amount Block', 'FAILED', 'REVERSE', false),
  '71': entry('Empty Mandate Reference Number', 'FAILED', 'REVERSE', false),
  '81': entry('Transaction Failed', 'FAILED', 'REVERSE', false),
  '91': entry('Beneficiary Bank Not Available', 'FAILED', 'REVERSE', true),
  '92': entry('Routing Error', 'FAILED', 'REVERSE', false),
  '94': entry('Duplicate Transaction', 'PENDING', 'NONE', true),
  '96': entry('System Malfunction', 'PENDING', 'NONE', true),
  '97': entry(
    'Timeout Waiting for response from Destination',
    'FAILED',
    'REVERSE',
    false,
  ),
  '98': entry('Transaction Exists', 'FAILED', 'NO_DEBIT', true),
  '99': entry('Transaction Failed', 'FAILED', 'NO_DEBIT', false),
  '500': entry('Internal server error', 'PENDING', 'NONE', true),
};

// The docs also list a literal `null` transactionStatus as "Failed with
// reversal" (FAILED, Reversal, TSQ required). TSQ-required wins, so it
// resolves to a requery like any other unknown value.
const UNKNOWN_TRANSACTION_STATUS: VfdCodeClassification = entry(
  'Missing/unrecognized transactionStatus (docs: null = "Failed with reversal") — verify via TSQ',
  'FAILED',
  'REVERSE',
  true,
);

export function classifyVfdTransactionStatus(
  code: string | null | undefined,
): VfdCodeClassification {
  if (!code) return UNKNOWN_TRANSACTION_STATUS;
  return TRANSACTION_STATUS_CODES[code] ?? UNKNOWN_TRANSACTION_STATUS;
}

// HOLD = definitively failed, but the provider says NOT to reverse — the
// customer's debit stays in place and the payout is flagged for manual
// review instead of being refunded.
export type VfdTransferOutcome = 'SUCCESSFUL' | 'FAILED' | 'HOLD' | 'REQUERY';

// The single decision point both call sites (the synchronous /transfer
// response and the TSQ poller) funnel through — mirrors VFD's own "Quick
// Guide": tsqRequired always wins (go verify, don't guess), otherwise trust
// the category, and a failure that VFD says not to reverse is held.
export function resolveVfdOutcome(
  classification: VfdCodeClassification,
): VfdTransferOutcome {
  if (classification.tsqRequired) return 'REQUERY';
  if (classification.category === 'SUCCESSFUL') return 'SUCCESSFUL';
  if (classification.category === 'FAILED') {
    return classification.reversal === 'NO_REVERSAL' ? 'HOLD' : 'FAILED';
  }
  return 'REQUERY';
}
