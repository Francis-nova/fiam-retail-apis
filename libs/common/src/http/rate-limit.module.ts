import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * Global per-IP rate limit (120 req/min). Sensitive routes tighten this with
 * `@Throttle` (login, OTP, PIN) and probes opt out with `@SkipThrottle`.
 * In-memory storage is fine while each service runs a single replica; move to
 * a Redis store before scaling out.
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
