import { BillType } from '../transactions/entities/transaction.entity';

// Plain-English names for a bill type, shared by the receipt email.
export const BILL_TYPE_LABEL: Record<BillType, string> = {
  [BillType.AIRTIME]: 'Airtime',
  [BillType.DATA]: 'Data',
  [BillType.CABLE_TV]: 'Cable TV',
  [BillType.INTERNET]: 'Internet',
  [BillType.UTILITY]: 'Electricity',
  [BillType.BETTING]: 'Betting',
  [BillType.OTHER]: 'Bill',
};

// What the number the bill was paid for is called.
export const BILL_CUSTOMER_LABEL: Record<BillType, string> = {
  [BillType.AIRTIME]: 'Phone number',
  [BillType.DATA]: 'Phone number',
  [BillType.CABLE_TV]: 'Smartcard / IUC number',
  [BillType.INTERNET]: 'Customer ID',
  [BillType.UTILITY]: 'Meter number',
  [BillType.BETTING]: 'Account ID',
  [BillType.OTHER]: 'Account',
};
