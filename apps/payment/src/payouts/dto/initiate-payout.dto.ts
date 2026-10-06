import {
  IsDecimal,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Either beneficiaryId, or both bankCode+accountNumber, must be provided —
// checked in PayoutsService (cross-field rules aren't worth a custom
// class-validator decorator for a two-field XOR).
export class InitiatePayoutDto {
  // The customer's 4-digit transaction PIN — verified server-side as part of
  // this request (never trust a separate "verify" call from the client).
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @IsOptional()
  @IsUUID()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  accountNumber?: string;

  // Naira decimal, string to avoid float precision issues — same convention
  // as Wallet.balance/Transaction.amount.
  @IsDecimal({ decimal_digits: '0,4' })
  amount: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;
}
