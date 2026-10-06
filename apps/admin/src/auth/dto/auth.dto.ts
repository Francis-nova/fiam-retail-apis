import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword: string;
}

// Step-2 of sign-in. `code` is a 6-digit authenticator code or a recovery code.
export class MfaVerifyDto {
  @IsString()
  mfaToken: string;

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code: string;
}

export class MfaTokenDto {
  @IsString()
  mfaToken: string;
}

export class MfaEnrollConfirmDto {
  @IsString()
  mfaToken: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your app' })
  code: string;
}

export class TotpCodeDto {
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from your app' })
  code: string;
}

export class DisableTwoFactorDto extends TotpCodeDto {
  @IsString()
  @MaxLength(200)
  password: string;
}
