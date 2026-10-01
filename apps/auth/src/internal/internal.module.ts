import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { InternalController } from './internal.controller';
import { InternalKeyGuard } from './internal-key.guard';

@Module({
  imports: [UsersModule],
  controllers: [InternalController],
  providers: [InternalKeyGuard],
})
export class InternalModule {}
