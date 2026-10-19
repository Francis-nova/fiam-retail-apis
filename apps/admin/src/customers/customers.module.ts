import { Module } from '@nestjs/common';
import { InternalHttpModule } from '../common/internal-http.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AuthClient } from './auth-client.service';
import { CustomerActionsService } from './customer-actions.service';
import { CustomersController } from './customers.controller';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';
import { CustomersService } from './customers.service';

@Module({
  imports: [TransactionsModule, InternalHttpModule],
  controllers: [CustomersController, ProvisioningController],
  providers: [
    CustomersService,
    CustomerActionsService,
    ProvisioningService,
    AuthClient,
  ],
  exports: [CustomersService, CustomerActionsService, AuthClient],
})
export class CustomersModule {}
