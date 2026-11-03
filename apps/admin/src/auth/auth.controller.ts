import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { DevicesService } from './devices.service';
import {
  AddDeviceDto,
  ChangePasswordDto,
  DeviceAssertDto,
  DeviceOptionsDto,
  DeviceRegisterDto,
  DisableTwoFactorDto,
  LoginDto,
  MfaEnrollConfirmDto,
  MfaTokenDto,
  MfaVerifyDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from './current-staff.decorator';
import { AllowPendingPasswordChange } from './roles.decorator';
import {
  RefreshCookieInterceptor,
  clearRefreshCookie,
  readRefreshCookie,
} from './refresh-cookie';

// Any response carrying a refresh token has it moved into an HttpOnly cookie.
@UseInterceptors(RefreshCookieInterceptor)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly devices: DevicesService,
  ) {}

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

  // --- Device lock: last sign-in step (authorised by the mfaToken) ---

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('device/options')
  @HttpCode(200)
  deviceOptions(@Body() dto: DeviceOptionsDto) {
    return this.auth.deviceOptions(dto.mfaToken, dto.mode);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('device/assert')
  @HttpCode(200)
  deviceAssert(@Body() dto: DeviceAssertDto, @ClientIp() ip: string | null) {
    return this.auth.deviceAssert(
      dto.mfaToken,
      dto.challengeToken,
      dto.response as unknown as AuthenticationResponseJSON,
      ip,
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('device/register')
  @HttpCode(200)
  deviceRegister(
    @Body() dto: DeviceRegisterDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.deviceRegister(
      dto.mfaToken,
      dto.challengeToken,
      dto.response as unknown as RegistrationResponseJSON,
      dto.label,
      ip,
    );
  }

  // --- Devices: managing your own, once signed in ---

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  listDevices(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.devices.list(staff.staffId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('devices/options')
  @HttpCode(200)
  addDeviceOptions(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.auth.addDeviceOptions(staff.staffId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('devices')
  @HttpCode(200)
  addDevice(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: AddDeviceDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.addDevice(
      staff.staffId,
      dto.challengeToken,
      dto.response as unknown as RegistrationResponseJSON,
      dto.label,
      ip,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('devices/:id')
  @HttpCode(204)
  async removeDevice(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ClientIp() ip: string | null,
  ) {
    await this.devices.revoke(staff.staffId, id, staff, ip);
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
  refresh(@Req() req: Request) {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedException();
    return this.auth.refresh(token);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshCookie(req);
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res);
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
      staff.deviceId,
    );
  }
}
