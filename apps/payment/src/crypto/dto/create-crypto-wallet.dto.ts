import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CurrencyCode } from '@app/common';

// The answers the app offers. Each value is StableStack's own enum value
// (occupations are their SOC codes), so they can be sent on unchanged.
export const ACCOUNT_PURPOSES = [
  'PERSONAL_OR_LIVING_EXPENSES',
  'PROTECT_WEALTH',
  'RECEIVE_PAYMENT_FOR_FREELANCING',
  'RECEIVE_SALARY',
  'PAYMENTS_TO_FRIENDS_OR_FAMILY_ABROAD',
  'INVESTMENT_PURPOSES',
  'PURCHASE_GOODS_AND_SERVICES',
  'OTHER',
] as const;

export const SOURCES_OF_FUNDS = [
  'SALARY',
  'BUSINESS_INCOME',
  'SAVINGS',
  'INVESTMENT_PROCEEDS',
  'GIFTS',
  'PENSION_RETIREMENT',
  'INHERITANCE',
] as const;

export const EMPLOYMENT_STATUSES = [
  'EMPLOYED',
  'SELF_EMPLOYED',
  'UNEMPLOYED',
  'STUDENT',
  'RETIRED',
  'OTHER',
] as const;

// shortcut: a short list of common jobs, checked against StableStack's code
// list; extend when compliance asks for more.
export const OCCUPATION_CODES = [
  '151251', // Software / IT
  '132011', // Accountant / auditor
  '111011', // Business owner / executive
  '111021', // Manager
  '172199', // Engineer
  '291299', // Doctor / healthcare
  '292061', // Nurse
  '252020', // Teacher
  '231011', // Lawyer
  '439061', // Office / admin
  '412010', // Sales / cashier
  '533030', // Driver
  '271024', // Designer / creative
  '131199', // Trader / business specialist
] as const;

export class ComplianceAnswers {
  @IsIn(ACCOUNT_PURPOSES)
  accountPurpose!: (typeof ACCOUNT_PURPOSES)[number];

  @IsIn(SOURCES_OF_FUNDS)
  sourceOfFunds!: (typeof SOURCES_OF_FUNDS)[number];

  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus!: (typeof EMPLOYMENT_STATUSES)[number];

  @IsIn(OCCUPATION_CODES)
  occupation!: (typeof OCCUPATION_CODES)[number];

  // Naira a month, from the band the customer picked.
  @IsInt()
  @IsIn([250_000, 1_000_000, 5_000_000, 10_000_000])
  expectedMonthlyIncome!: number;

  // The risk disclosure must be ticked.
  @IsBoolean()
  @Equals(true)
  acceptedRiskDisclosure!: boolean;
}

export class CreateCryptoWalletDto {
  @IsIn([CurrencyCode.USDC, CurrencyCode.USDT])
  currency!: CurrencyCode.USDC | CurrencyCode.USDT;

  // Required the first time (no StableStack customer yet); ignored after.
  @IsOptional()
  @ValidateNested()
  @Type(() => ComplianceAnswers)
  compliance?: ComplianceAnswers;
}
