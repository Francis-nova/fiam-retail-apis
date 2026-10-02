import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Every state-changing action needs a reason; it goes into the audit log.
export class ReasonDto {
  @IsString()
  @MinLength(3, { message: 'Give a reason (at least 3 characters)' })
  @MaxLength(500)
  reason: string;
}

// Email is deliberately not editable: it's the password-reset channel, so
// changing it is an account-takeover vector.
export class UpdateCustomerDto extends ReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[+\d\s-]{10,20}$/, { message: 'Enter a valid phone number' })
  phone?: string;
}

export class ApproveUpgradeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
