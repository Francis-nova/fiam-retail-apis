import { IsNumber, Min, ValidateIf } from 'class-validator';

// Both fields are required; null resets that cap to the tier ceiling.
export class SetTransferLimitsDto {
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  perTransfer: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  daily: number | null;
}
