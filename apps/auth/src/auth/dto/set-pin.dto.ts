import { Matches } from 'class-validator';

export class SetPinDto {
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;

  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  confirmPin: string;
}
