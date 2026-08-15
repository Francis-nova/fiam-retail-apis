import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateBiometricPreferencesDto {
  @IsOptional()
  @IsBoolean()
  loginEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  transactionEnabled?: boolean;
}
