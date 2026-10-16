import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { CurrencyCode } from '@app/common';
import { Wallet } from '../wallets/entities/wallet.entity';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { PaymentSlackNotifier } from '../slack/payment-slack.notifier';

@Injectable()
export class PoolBalanceService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
    private readonly slack: PaymentSlackNotifier,
  ) {}

  // What the platform holds at the provider vs what it owes customers. Throws
  // if the provider can't be reached, so the job retries and the failure is
  // reported rather than a made-up number being posted.
  async report(): Promise<{
    pool: Decimal;
    customers: Decimal;
    count: number;
  }> {
    const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
    // No account number = the pool account itself.
    const pool = await provider.getAccountDetails();
    if (pool.balance === null || pool.balance === undefined) {
      throw new Error('VFD did not return the pool account balance');
    }
    const row = await this.wallets
      .createQueryBuilder('w')
      .select('COALESCE(SUM(w.balance), 0)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('w.currency = :currency', { currency: CurrencyCode.NGN })
      .getRawOne<{ total: string; count: string }>();
    const result = {
      pool: new Decimal(pool.balance.replace(/,/g, '')),
      customers: new Decimal(row?.total ?? 0),
      count: Number(row?.count ?? 0),
    };
    this.slack.poolBalance({
      pool: result.pool,
      customers: result.customers,
      customerCount: result.count,
    });
    return result;
  }
}
