import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  LoginDto,
  MfaEnrollConfirmDto,
  MfaTokenDto,
  MfaVerifyDto,
  RefreshDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from './current-staff.decorator';
import { AllowPendingPasswordChange } from './roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @ClientIp() ip: string | null) {
    return this.auth.login(dto.email, dto.password, ip);
  }

  // --- Two-factor: sign-in steps (authorised by the short-lived mfaToken) ---

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() dto: MfaVerifyDto, @ClientIp() ip: string | null) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code, ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enroll/start')
  @HttpCode(200)
  startMfaEnrollment(@Body() dto: MfaTokenDto) {
    return this.auth.startEnrollmentWithToken(dto.mfaToken);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  confirmMfaEnrollment(
    @Body() dto: MfaEnrollConfirmDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.confirmEnrollmentWithToken(dto.mfaToken, dto.code, ip);
  }

  // --- Two-factor: managing your own, once signed in ---

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/setup')
  @HttpCode(200)
  setupTwoFactor(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.auth.startEnrollment(staff.staffId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(200)
  enableTwoFactor(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: TotpCodeDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.confirmEnrollment(staff.staffId, dto.code, ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: DisableTwoFactorDto,
    @ClientIp() ip: string | null,
  ) {
    await this.auth.disableTwoFactor(staff.staffId, dto.password, dto.code, ip);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: TotpCodeDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.regenerateRecoveryCodes(staff.staffId, dto.code, ip);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentStaff() staff: AuthenticatedStaff) {
    return staff;
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @AllowPendingPasswordChange()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: ChangePasswordDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.changePassword(
      staff.staffId,
      dto.currentPassword,
      dto.newPassword,
      ip,
    );
  }
}
