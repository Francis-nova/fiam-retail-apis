export const BILL_STATUS_QUERY_QUEUE = 'bill-status-query';
export const PROCESS_BILL_STATUS_QUERY_JOB = 'process-bill-status-query';

export interface BillStatusQueryJobData {
  transactionId: string;
  // Id of the request that enqueued the job, for log correlation.
  requestId?: string;
}
