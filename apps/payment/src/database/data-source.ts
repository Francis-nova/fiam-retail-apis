import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Address } from '../wallets/entities/address.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Beneficiary } from '../beneficiaries/entities/beneficiary.entity';

// Each app now owns its own .env (apps/<app>/.env) rather than a shared
// root one — the CLI (invoked from the apis/ root, see package.json's
// migration:*:payment scripts) needs pointing at this app's specifically.
config({ path: 'apps/payment/.env', quiet: true });

// Standalone DataSource used by the TypeORM CLI (migration:generate / migration:run).
// Kept separate from database.module.ts's ConfigService-driven setup since the CLI
// runs outside the Nest DI container.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.PAYMENT_DATABASE_URL,
  entities: [Wallet, Address, Transaction, Beneficiary],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
