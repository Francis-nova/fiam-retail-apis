import { Module } from '@nestjs/common';
import { InternalHttpModule } from '../common/internal-http.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AuthClient } from './auth-client.service';
import { CustomerActionsService } from './customer-actions.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [TransactionsModule, InternalHttpModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerActionsService, AuthClient],
  exports: [CustomersService, CustomerActionsService, AuthClient],
})
export class CustomersModule {}
