import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PaymentConfig } from '../config/configuration';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// A plain ioredis client, separate from BullMQ's own internal connection —
// used for simple cache reads/writes (e.g. BanksService's bank-list cache)
// that have nothing to do with the job queue.
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<PaymentConfig, true>) =>
        new Redis(configService.get('redis.url', { infer: true })),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
