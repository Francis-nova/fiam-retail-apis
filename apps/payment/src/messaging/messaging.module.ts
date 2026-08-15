import { Module } from '@nestjs/common';
import { AccountProvisioningConsumer } from './account-provisioning.consumer';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [WalletsModule],
  controllers: [AccountProvisioningConsumer],
})
export class MessagingModule {}
