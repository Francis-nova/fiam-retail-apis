import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { CurrencyCode } from '@app/common';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import type { ProviderBank } from '../providers/payment-provider.interface';

const CACHE_KEY_PREFIX = 'payment:banks:';
// Bank lists barely ever change — cache for 24 hours per the product
// decision, refetched from VFD only on a cache miss/expiry.
const CACHE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class BanksService {
  private readonly logger = new Logger(BanksService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async listBanks(currency: CurrencyCode): Promise<ProviderBank[]> {
    const provider = this.registry.getProviderForCurrency(currency);
    const cacheKey = `${CACHE_KEY_PREFIX}${provider.key}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as ProviderBank[];
      } catch {
        this.logger.warn(
          `Corrupt bank-list cache entry at ${cacheKey} — refetching`,
        );
      }
    }

    const banks = await provider.listBanks();
    await this.redis.set(
      cacheKey,
      JSON.stringify(banks),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return banks;
  }
}
