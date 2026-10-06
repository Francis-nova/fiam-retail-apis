import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { TransactionType } from '../transactions/entities/transaction.entity';

export class CreatePostingDto {
  @IsUUID()
  walletId: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  // Decimal string, up to 4 dp, strictly positive (checked again in the service).
  @Matches(/^\d{1,11}(\.\d{1,4})?$/, {
    message: 'amount must be a positive decimal',
  })
  amount: string;

  // Idempotency key: replaying the same reference returns the original posting.
  @IsString()
  @MaxLength(50)
  reference: string;

  @IsString()
  @MaxLength(255)
  narration: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
