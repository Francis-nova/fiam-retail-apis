import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { CurrentUser } from '../tokens/current-user.decorator';
import type { AuthenticatedUser } from '../tokens/current-user.decorator';
import { DeletionService } from './deletion.service';
import { RequestDeletionDto } from './deletion.dto';

@Controller('account/deletion-request')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DeletionController {
  constructor(private readonly deletion: DeletionService) {}

  @Get()
  current(@CurrentUser() user: AuthenticatedUser) {
    return this.deletion.current(user.userId);
  }

  @Post()
  @HttpCode(200)
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestDeletionDto,
  ) {
    return this.deletion.request(user.userId, dto.password, dto.reason);
  }

  @Delete()
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.deletion.cancel(user.userId);
  }
}
