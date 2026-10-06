import { Module } from '@nestjs/common';
import { RateLimitModule } from '@app/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AdminAuthModule } from './auth/auth.module';
import { ReadonlyDatabaseModule } from './database/readonly-database.module';
import { DeletionRequestsModule } from './deletion-requests/deletion-requests.module';
import { PostingsModule } from './postings/postings.module';
import { CustomersModule } from './customers/customers.module';
import { TransactionsModule } from './transactions/transactions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { StaffModule } from './staff/staff.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    RateLimitModule.forRoot('admin'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/admin/.env',
      load: [configuration],
      validate,
    }),
    DatabaseModule,
    ReadonlyDatabaseModule,
    AuditModule,
    AdminAuthModule,
    StaffModule,
    TransactionsModule,
    DashboardModule,
    CustomersModule,
    PostingsModule,
    DeletionRequestsModule,
    ReconciliationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
