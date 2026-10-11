import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

// Placeholder shell — wallets/ledger/transactions/idempotency/outbox modules
// land in the step after auth, per the architecture plan.
@SkipThrottle()
@Controller('health')
export class AppController {
  constructor(private readonly dataSource: DataSource) {}

  // Liveness: the process is up. Used by the container healthcheck, so it
  // must not depend on anything external.
  @Get()
  check() {
    return { status: 'ok', service: 'payment' };
  }

  // Readiness: the dependencies this service cannot work without.
  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        db: 'down',
      });
    }
    return { status: 'ok', service: 'payment', db: 'up' };
  }
}
