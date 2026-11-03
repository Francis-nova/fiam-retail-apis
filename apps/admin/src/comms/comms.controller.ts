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
import { CommsService } from './comms.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

// Messaging every customer is high-blast-radius: super admins only.
@ApiBearerAuth()
@Controller('comms/broadcasts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPER_ADMIN)
export class CommsController {
  constructor(private readonly comms: CommsService) {}

  @Post()
  @HttpCode(202)
  create(
    @Body() dto: CreateBroadcastDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.comms.create(dto, { actor, ip });
  }

  @Get()
  list(@Query() q: PaginationQueryDto) {
    return this.comms.list(q.page ?? 1, q.pageSize ?? 25);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.comms.get(id);
  }
}
