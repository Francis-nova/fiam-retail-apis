import { IsString, Length } from 'class-validator';

export class OtpCodeDto {
  @IsString()
  @Length(4, 8)
  code: string;
}
