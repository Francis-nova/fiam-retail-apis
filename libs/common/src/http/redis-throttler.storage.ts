import { Logger, OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

// Atomic fixed-window counter: INCR, and start the window's TTL on the first
// hit. Returns [hits, ms remaining].
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if hits == 1 or pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return { hits, pttl }
`;

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Shared rate-limit counters in Redis, so limits hold across restarts and
 * replicas (the default in-memory store is per-process). Fails open: if Redis
 * is unreachable the request is allowed and a warning is logged — account
 * lockouts live in Postgres, so the secrets stay protected either way.
 */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger('RateLimit');
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly prefix: string,
  ) {
    this.redis = new Redis(url, {
      // Commands queue while connecting (so the first requests after boot are
      // still counted) but never hold a request for more than half a second.
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
    });
    this.redis.on('error', (err) =>
      this.logger.warn(`Redis unavailable: ${err.message}`),
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      const [hits, pttl] = (await this.redis.eval(
        INCREMENT,
        1,
        `throttle:${this.prefix}:${throttlerName}:${key}`,
        ttl,
      )) as [number, number];
      const seconds = Math.ceil(pttl / 1000);
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire: seconds,
        isBlocked,
        timeToBlockExpire: isBlocked ? seconds : 0,
      };
    } catch (err) {
      this.logger.warn(`Rate limit check skipped: ${(err as Error).message}`);
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
