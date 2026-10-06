import { pgSsl } from '@app/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminConfig } from '../config/configuration';
import { StaffUser } from '../staff/entities/staff-user.entity';
import { StaffRefreshToken } from '../auth/entities/staff-refresh-token.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Posting } from '../postings/entities/posting.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AdminConfig, true>) => ({
        type: 'postgres',
        url: config.get('database.url', { infer: true }),
        ssl: pgSsl(),
        entities: [StaffUser, StaffRefreshToken, AuditLog, Posting],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
