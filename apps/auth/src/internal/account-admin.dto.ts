import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AccountActionDto {
  // Which staff member did it (for the customer-facing record).
  @IsOptional()
  @IsString()
  @MaxLength(254)
  actorEmail?: string;

  // Why staff did this — carried into the console's audit log, not stored here.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateProfileDto {
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
  @MaxLength(20)
  phone?: string;
}
