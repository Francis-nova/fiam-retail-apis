import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// Placeholder shell — wallets/ledger/transactions/idempotency/outbox modules
// land in the step after auth, per the architecture plan.
@SkipThrottle()
@Controller('health')
export class AppController {
  @Get()
  check() {
    return { status: 'ok', service: 'payment' };
  }
}
