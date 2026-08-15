import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { ACCOUNT_PROVISIONING_REQUESTED_PATTERN } from '@app/common';
import type { AccountProvisioningRequestedMessage } from '@app/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import { AddressService } from '../wallets/address.service';

@Controller()
export class AccountProvisioningConsumer {
  private readonly logger = new Logger(AccountProvisioningConsumer.name);

  constructor(private readonly addressService: AddressService) {}

  @EventPattern(ACCOUNT_PROVISIONING_REQUESTED_PATTERN)
  async handle(
    @Payload() message: AccountProvisioningRequestedMessage,
    @Ctx() context: RmqContext,
  ) {
    // RmqContext types these as `any`/`Record<string, any>` — narrow to
    // amqplib's real types so ack/nack are type-checked.
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as ConsumeMessage;
    try {
      await this.addressService.provisionAddress(
        message.userId,
        message.currency,
        {
          bvn: message.bvn,
          dateOfBirth: message.dateOfBirth,
          firstName: message.firstName,
          lastName: message.lastName,
        },
      );
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error(
        `Provisioning failed for user ${message.userId}: ${(err as Error).message}`,
      );
      // No requeue — a permanently-failing VFD call (e.g. bad BVN) would
      // otherwise loop forever. Routes to the queue's dead-letter exchange
      // for manual investigation instead.
      channel.nack(originalMsg, false, false);
    }
  }
}
