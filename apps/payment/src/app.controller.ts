import { Controller, Get } from '@nestjs/common';

// Placeholder shell — wallets/ledger/transactions/idempotency/outbox modules
// land in the step after auth, per the architecture plan.
@Controller('health')
export class AppController {
  @Get()
  check() {
    return { status: 'ok', service: 'payment' };
  }
}
