import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto';

export enum TxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
  UNMATCHED = 'UNMATCHED',
}

export enum TxType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export class ListTransactionsQueryDto extends PaginationQueryDto {
  // Reference, session id, account number, narration, or the customer's
  // name / email / phone.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // Comma-separated, e.g. "PENDING,PROCESSING".
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : (value as unknown),
  )
  @IsEnum(TxStatus, { each: true })
  status?: TxStatus[];

  @IsOptional()
  @IsEnum(TxType)
  type?: TxType;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  walletId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
