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
import { PostingsService } from './postings.service';
import {
  CreatePostingDto,
  DecisionDto,
  ListPostingsQueryDto,
  RejectDto,
} from './dto/postings.dto';

// Request: FINANCE. Decide: COMPLIANCE. SUPER_ADMIN passes every role check,
// but the service still refuses anyone deciding their own request.
@ApiBearerAuth()
@Controller('postings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.FINANCE, StaffRole.COMPLIANCE)
export class PostingsController {
  constructor(private readonly postings: PostingsService) {}

  @Get()
  list(@Query() q: ListPostingsQueryDto) {
    return this.postings.list(q);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.postings.get(id);
  }

  @Post()
  @Roles(StaffRole.FINANCE)
  request(
    @Body() dto: CreatePostingDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.postings.request(dto, { actor, ip });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles(StaffRole.COMPLIANCE)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecisionDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.postings.approve(id, dto.note, { actor, ip });
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles(StaffRole.COMPLIANCE)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.postings.reject(id, dto.note, { actor, ip });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(StaffRole.FINANCE)
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.postings.cancel(id, { actor, ip });
  }
}
