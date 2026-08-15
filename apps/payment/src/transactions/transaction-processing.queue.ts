export const TRANSACTION_PROCESSING_QUEUE = 'transaction-processing';
export const PROCESS_TRANSACTION_JOB = 'process-transaction';

export interface ProcessTransactionJobData {
  transactionId: string;
}
