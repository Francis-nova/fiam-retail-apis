import { IsDecimal, IsIn, IsOptional, Matches } from 'class-validator';
import { CurrencyCode } from '@app/common';

// Blockchain addresses are alphanumeric (0x… for EVM, T… for Tron);
// StableStack checks the address properly before anything is sent.
const ADDRESS = /^[A-Za-z0-9]{20,128}$/;

export class QuoteCryptoWithdrawalDto {
  @IsIn([CurrencyCode.USDC, CurrencyCode.USDT])
  currency!: CurrencyCode.USDC | CurrencyCode.USDT;

  // What leaves the customer's wallet; every fee comes out of it.
  @IsDecimal({ decimal_digits: '0,6' })
  amount!: string;

  @IsOptional()
  @Matches(ADDRESS, { message: 'Enter a valid wallet address' })
  address?: string;
}

export class CreateCryptoWithdrawalDto {
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin!: string;

  @IsIn([CurrencyCode.USDC, CurrencyCode.USDT])
  currency!: CurrencyCode.USDC | CurrencyCode.USDT;

  @IsDecimal({ decimal_digits: '0,6' })
  amount!: string;

  @Matches(ADDRESS, { message: 'Enter a valid wallet address' })
  address!: string;
}
