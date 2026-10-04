import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { POSTOFFICE_NOTIFICATION_QUEUE } from '@app/common';
import { StaffUser } from '../staff/entities/staff-user.entity';
import { AdminConfig } from '../config/configuration';
import { AlertsService } from './alerts.service';
import { POSTOFFICE_NOTIFICATION_CLIENT } from './postoffice-client.token';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, StaffUser]),
    // Same queue options as every other producer (auth, payment): RabbitMQ
    // refuses a queue redeclared with different arguments.
    ClientsModule.registerAsync([
      {
        name: POSTOFFICE_NOTIFICATION_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService<AdminConfig, true>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              config.get('rabbitmq', { infer: true }).url ||
                'amqp://localhost:5672',
            ],
            queue: POSTOFFICE_NOTIFICATION_QUEUE,
            queueOptions: {
              durable: true,
              deadLetterExchange: `${POSTOFFICE_NOTIFICATION_QUEUE}.dlx`,
            },
          },
        }),
      },
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService, AlertsService],
  exports: [AuditService],
})
export class AuditModule {}
