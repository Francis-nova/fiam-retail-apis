import { IsOptional, IsString } from 'class-validator';

// Property names match VFD's documented payload verbatim (snake_case) —
// avoids class-transformer @Expose renaming boilerplate for a shape we
// don't control.
export class VfdInwardCreditWebhookDto {
  @IsString()
  reference: string;

  @IsString()
  amount: string;

  @IsString()
  account_number: string;

  @IsOptional()
  @IsString()
  originator_account_number?: string;

  @IsOptional()
  @IsString()
  originator_account_name?: string;

  @IsOptional()
  @IsString()
  originator_bank?: string;

  @IsOptional()
  @IsString()
  originator_narration?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  transaction_channel?: string;

  @IsOptional()
  @IsString()
  session_id?: string;
}
