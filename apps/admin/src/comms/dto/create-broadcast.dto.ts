import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBroadcastDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(['push', 'email'], { each: true })
  channels: Array<'push' | 'email'>;

  @IsString()
  @MinLength(1)
  @MaxLength(65) // keeps the push title from truncating
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body: string;

  // Omit to send to every active customer.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  customerIds?: string[];
}
