import { DynamicModule, Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Global per-IP rate limit (120 req/min). Sensitive routes tighten this with
 * `@Throttle` (login, OTP, PIN) and probes opt out with `@SkipThrottle`.
 *
 * Counters live in Redis (`REDIS_URL`) so they survive restarts and are
 * shared across replicas; without REDIS_URL (local dev) it falls back to the
 * in-process store. `service` namespaces the keys per API.
 */
@Module({})
export class RateLimitModule {
  static forRoot(service: string): DynamicModule {
    return {
      module: RateLimitModule,
      imports: [
        ThrottlerModule.forRootAsync({
          useFactory: () => {
            const url = process.env.REDIS_URL;
            if (!url) {
              new Logger('RateLimit').warn(
                'REDIS_URL not set — using in-memory rate limits',
              );
            }
            return {
              throttlers: [{ ttl: 60_000, limit: 120 }],
              ...(url
                ? { storage: new RedisThrottlerStorage(url, service) }
                : {}),
            };
          },
        }),
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    };
  }
}
