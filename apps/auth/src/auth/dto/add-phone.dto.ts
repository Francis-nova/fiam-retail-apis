import { IsString } from 'class-validator';

export class AddPhoneDto {
  @IsString()
  phone: string;
}
