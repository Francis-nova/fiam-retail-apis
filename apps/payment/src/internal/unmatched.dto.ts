import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AssignUnmatchedDto {
  @IsUUID()
  walletId: string;

  // The posting's own reference (MAN-<id>) — for the audit trail.
  @IsString()
  @MaxLength(100)
  reference: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
