import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from '../auth/current-staff.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { PaginationQueryDto } from '../common/pagination.dto';
import {
  ApproveUpgradeDto,
  ReasonDto,
} from '../customers/dto/customer-actions.dto';
import { DeletionRequestsService } from './deletion-requests.service';

enum RequestStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

class ListQuery extends PaginationQueryDto {
  // Comma-separated, e.g. "REJECTED,CANCELLED".
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : value,
  )
  @IsEnum(RequestStatus, { each: true })
  status?: RequestStatus[];
}

// Same people who review accounts: compliance and super admins.
@ApiBearerAuth()
@Controller('deletion-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.COMPLIANCE)
export class DeletionRequestsController {
  constructor(private readonly requests: DeletionRequestsService) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.requests.list({
      status: q.status,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 25,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveUpgradeDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.requests.approve(id, dto.note, { actor, ip });
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.requests.reject(id, dto.reason, { actor, ip });
  }
}
