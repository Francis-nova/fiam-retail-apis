import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// Either beneficiaryId, or both bankCode+accountNumber, must be provided —
// checked in PayoutsService (cross-field rules aren't worth a custom
// class-validator decorator for a two-field XOR).
export class InitiatePayoutDto {
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

  // Minor units (kobo), string to avoid float precision issues — same
  // convention as Wallet.balanceMinor/Transaction.amountMinor.
  @IsNumberString()
  amountMinor: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;
}
