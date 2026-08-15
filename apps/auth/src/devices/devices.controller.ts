import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { DevicesService } from './devices.service';
import { UpdateBiometricPreferencesDto } from './dto/update-biometric-preferences.dto';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { CurrentUser } from '../tokens/current-user.decorator';
import type { AuthenticatedUser } from '../tokens/current-user.decorator';

@Controller('devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.listForUser(user.userId);
  }

  @Patch('current/biometric')
  updateBiometricPreferences(
    @Body() dto: UpdateBiometricPreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId !== 'string' || !deviceId) {
      throw new BadRequestException('Missing x-device-id header');
    }
    return this.devicesService.setBiometricPreferences(user.userId, deviceId, {
      loginEnabled: dto.loginEnabled,
      transactionEnabled: dto.transactionEnabled,
    });
  }
}
