import { IsEmail, IsEnum, IsString, Length } from 'class-validator';
import { OtpPurpose } from '../../otp/entities/otp.entity';

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(4, 8)
  code: string;

  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}
