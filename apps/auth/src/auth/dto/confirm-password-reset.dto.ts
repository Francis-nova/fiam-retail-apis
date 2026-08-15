import { IsString, Matches, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  resetToken: string;

  @IsString()
  @MinLength(8)
  @Matches(/(?=.*\d)(?=.*[^A-Za-z0-9])/, {
    message: 'Password must contain a number and a symbol',
  })
  newPassword: string;
}
