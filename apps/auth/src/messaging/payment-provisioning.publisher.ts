import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ACCOUNT_PROVISIONING_REQUESTED_PATTERN,
  AccountProvisioningRequestedMessage,
} from '@app/common';
import { PAYMENT_PROVISIONING_CLIENT } from './payment-provisioning-client.token';

// Fire-and-forget publish — acceptable because the caller has already
// durably recorded "we decided to provision" via
// UsersService.claimPaymentAccountProvisioning before calling this. A brief
// broker outage swallowing this emit silently is a known v1 gap (no
// transactional outbox); a good follow-up, not required for launch.
@Injectable()
export class PaymentProvisioningPublisher {
  constructor(
    @Inject(PAYMENT_PROVISIONING_CLIENT) private readonly client: ClientProxy,
  ) {}

  requestNgnAccountProvisioning(
    message: AccountProvisioningRequestedMessage,
  ): void {
    this.client.emit(ACCOUNT_PROVISIONING_REQUESTED_PATTERN, message);
  }
}
