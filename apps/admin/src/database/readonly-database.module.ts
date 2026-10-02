import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminConfig } from '../config/configuration';

export const PAYMENT_DB = 'payment';
export const AUTH_DB = 'auth';

// Entity-less connections into the other services' databases. The console
// reads with raw SQL so it doesn't import (and couple to) those services'
// entities, and the session is forced read-only so a bug here can't write.
const readonly = (name: string, key: 'authUrl' | 'paymentUrl') =>
  TypeOrmModule.forRootAsync({
    name,
    inject: [ConfigService],
    useFactory: (config: ConfigService<AdminConfig, true>) => ({
      type: 'postgres' as const,
      url: config.get(`database.${key}`, { infer: true }),
      entities: [],
      synchronize: false,
      migrationsRun: false,
      extra: { options: '-c default_transaction_read_only=on' },
    }),
  });

@Module({
  imports: [readonly(PAYMENT_DB, 'paymentUrl'), readonly(AUTH_DB, 'authUrl')],
})
export class ReadonlyDatabaseModule {}
