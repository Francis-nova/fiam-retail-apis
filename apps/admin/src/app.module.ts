import { Module } from '@nestjs/common';
import { RateLimitModule, AppLoggerModule } from '@app/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import configuration from './config/configuration';
import { AdminConfig } from './config/configuration';
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
import { SettingsModule } from './settings/settings.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { CommsModule } from './comms/comms.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    AppLoggerModule.forRoot('admin'),
    RateLimitModule.forRoot('admin'),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/admin/.env',
      load: [configuration],
      validate,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AdminConfig, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
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
    SettingsModule,
    CommsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
