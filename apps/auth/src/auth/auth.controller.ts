import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService, RequestMeta } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ResendRegistrationOtpDto } from './dto/resend-registration-otp.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpCodeDto } from './dto/otp-code.dto';
import { AddPhoneDto } from './dto/add-phone.dto';
import { SubmitBvnDto } from './dto/submit-bvn.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { VerifyPasswordResetOtpDto } from './dto/verify-password-reset-otp.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { VerifyLoginPinDto } from './dto/verify-login-pin.dto';
import { VerifyPinDto } from './dto/verify-pin.dto';
import { ResetPinDto } from './dto/reset-pin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { CurrentUser } from '../tokens/current-user.decorator';
import type { AuthenticatedUser } from '../tokens/current-user.decorator';

function requestMeta(req: Request): RequestMeta {
  return {
    deviceId:
      typeof req.headers['x-device-id'] === 'string'
        ? req.headers['x-device-id']
        : undefined,
    deviceName:
      typeof req.headers['x-device-name'] === 'string'
        ? req.headers['x-device-name']
        : undefined,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('otp/resend')
  resendRegistrationOtp(@Body() dto: ResendRegistrationOtpDto) {
    return this.authService.resendRegistrationOtp(dto.email);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.authService.verifyOtp(
      dto.email,
      dto.code,
      dto.purpose,
      requestMeta(req),
    );
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, requestMeta(req));
  }

  @Post('login/pin')
  confirmLoginPin(@Body() dto: VerifyLoginPinDto, @Req() req: Request) {
    return this.authService.confirmLoginPin(
      dto.loginTicket,
      dto.pin,
      requestMeta(req),
    );
  }

  @Post('pin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPin(@Body() dto: SetPinDto, @CurrentUser() user: AuthenticatedUser) {
    await this.authService.setTransactionPin(
      user.userId,
      dto.pin,
      dto.confirmPin,
    );
  }

  @Post('pin/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyPin(
    @Body() dto: VerifyPinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.authService.verifyTransactionPin(user.userId, dto.pin);
  }

  @Post('pin/reset')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPin(
    @Body() dto: ResetPinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.authService.resetTransactionPin(
      user.userId,
      dto.currentPin,
      dto.newPin,
      dto.confirmNewPin,
    );
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.authService.changePassword(
      user.userId,
      user.sessionId,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmNewPassword,
    );
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.userId, user.sessionId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.authService.me(user.userId, requestMeta(req).deviceId);
  }

  @Post('phone')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  addPhone(@Body() dto: AddPhoneDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.addPhone(user.userId, dto.phone);
  }

  @Post('phone/resend')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  resendPhoneOtp(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.resendPhoneOtp(user.userId);
  }

  @Post('phone/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  verifyPhone(@Body() dto: OtpCodeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.verifyPhoneOtp(user.userId, dto.code);
  }

  @Post('bvn')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  submitBvn(@Body() dto: SubmitBvnDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.submitBvn(user.userId, dto.bvn, dto.dateOfBirth);
  }

  @Post('bvn/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  verifyBvn(@Body() dto: OtpCodeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.authService.verifyBvnOtp(user.userId, dto.code);
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('password-reset/verify')
  verifyPasswordResetOtp(@Body() dto: VerifyPasswordResetOtpDto) {
    return this.authService.verifyPasswordResetOtp(dto.email, dto.code);
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    await this.authService.confirmPasswordReset(
      dto.resetToken,
      dto.newPassword,
    );
  }
}
