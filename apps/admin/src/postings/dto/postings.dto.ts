import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { PostingStatus, PostingType } from '../entities/posting.entity';

export class CreatePostingDto {
  @IsUUID()
  customerId: string;

  @IsEnum(PostingType)
  type: PostingType;

  // Positive decimal, up to 4 dp (the wallet's precision).
  @Matches(/^\d{1,11}(\.\d{1,4})?$/, { message: 'Enter a valid amount' })
  amount: string;

  // Internal justification; never shown to the customer.
  @IsString()
  @MinLength(5, { message: 'Explain why (at least 5 characters)' })
  @MaxLength(500)
  reason: string;

  // What the customer sees on their statement. Defaults to a neutral line.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  narration?: string;
}

export class DecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectDto {
  @IsString()
  @MinLength(3, {
    message: 'Give a reason for rejecting (at least 3 characters)',
  })
  @MaxLength(500)
  note: string;
}

export class ListPostingsQueryDto extends PaginationQueryDto {
  // Comma-separated, e.g. "PENDING,PROCESSING".
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : value,
  )
  @IsEnum(PostingStatus, { each: true })
  status?: PostingStatus[];

  @IsOptional()
  @IsUUID()
  customerId?: string;
}
