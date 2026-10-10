export const PAYOUT_STATUS_QUERY_QUEUE = 'payout-status-query';
export const PROCESS_PAYOUT_STATUS_QUERY_JOB = 'process-payout-status-query';

export interface PayoutStatusQueryJobData {
  transactionId: string;
  // Id of the request that enqueued the job, for log correlation.
  requestId?: string;
}
