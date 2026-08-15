import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyPasswordResetOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(4, 8)
  code: string;
}
