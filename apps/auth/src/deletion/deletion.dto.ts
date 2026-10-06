import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestDeletionDto {
  // Re-authentication: a stolen unlocked phone must not be able to start this.
  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
