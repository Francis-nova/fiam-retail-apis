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
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto/auth.dto';
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

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @ClientIp() ip: string | null) {
    return this.auth.login(dto.email, dto.password, ip);
  }

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
