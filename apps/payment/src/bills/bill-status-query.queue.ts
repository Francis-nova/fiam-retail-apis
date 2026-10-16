export const BILL_STATUS_QUERY_QUEUE = 'bill-status-query';
export const PROCESS_BILL_STATUS_QUERY_JOB = 'process-bill-status-query';
// A paid electricity bill whose token VFD hadn't issued yet: fetch it, then send
// the receipt email that carries it.
export const FETCH_BILL_TOKEN_JOB = 'fetch-bill-token';

export interface BillStatusQueryJobData {
  transactionId: string;
  // Id of the request that enqueued the job, for log correlation.
  requestId?: string;
}
