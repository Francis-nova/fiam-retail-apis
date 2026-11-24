import { IsDecimal, IsIn, Matches } from 'class-validator';
import { CurrencyCode } from '@app/common';

export class QuoteConversionDto {
  @IsIn([CurrencyCode.USDC, CurrencyCode.USDT])
  currency!: CurrencyCode.USDC | CurrencyCode.USDT;

  // The coin amount sold; the minimum is checked in the service.
  @IsDecimal({ decimal_digits: '0,6' })
  amount!: string;
}

export class CreateConversionDto extends QuoteConversionDto {
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin!: string;
}
