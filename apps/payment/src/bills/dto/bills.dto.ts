import {
  IsDecimal,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// The three identifiers VFD's biller list hands out; every later call
// (items, validate, pay) is keyed by them.
export class BillerRefDto {
  @IsString()
  @MinLength(1)
  billerId: string;

  @IsString()
  @MinLength(1)
  divisionId: string;

  @IsString()
  @MinLength(1)
  productId: string;
}

export class ValidateCustomerDto extends BillerRefDto {
  // The item's paymentCode.
  @IsString()
  @MinLength(1)
  paymentItem: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  customerId: string;
}

export class PayBillDto extends ValidateCustomerDto {
  // The customer's 4-digit transaction PIN, verified as part of this request.
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  // Naira decimal string, same convention as payouts.
  @IsDecimal({ decimal_digits: '0,2' })
  amount: string;

  @IsOptional()
  @Matches(/^\+?\d{7,15}$/, { message: 'phoneNumber must be a phone number' })
  phoneNumber?: string;
}
