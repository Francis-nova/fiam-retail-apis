import { IsEmail } from 'class-validator';

export class ResendRegistrationOtpDto {
  @IsEmail()
  email: string;
}
