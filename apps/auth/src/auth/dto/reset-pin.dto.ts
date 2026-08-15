import { Matches } from 'class-validator';

export class ResetPinDto {
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  currentPin: string;

  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  newPin: string;

  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  confirmNewPin: string;
}
