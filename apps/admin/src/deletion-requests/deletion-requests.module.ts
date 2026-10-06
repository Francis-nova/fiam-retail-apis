import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { DeletionRequestsController } from './deletion-requests.controller';
import { DeletionRequestsService } from './deletion-requests.service';

@Module({
  imports: [CustomersModule],
  controllers: [DeletionRequestsController],
  providers: [DeletionRequestsService],
})
export class DeletionRequestsModule {}
