import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffRefreshToken } from '../auth/entities/staff-refresh-token.entity';
import { StaffUser } from './entities/staff-user.entity';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [TypeOrmModule.forFeature([StaffUser, StaffRefreshToken])],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
