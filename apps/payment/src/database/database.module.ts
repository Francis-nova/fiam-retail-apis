import { pgSsl } from '@app/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Address } from '../wallets/entities/address.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Beneficiary } from '../beneficiaries/entities/beneficiary.entity';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';
import { PaymentConfig } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<PaymentConfig, true>) => ({
        type: 'postgres',
        url: configService.get('database.url', { infer: true }),
        ssl: pgSsl(),
        entities: [Wallet, Address, Transaction, Beneficiary, WebhookEvent],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
