import { pgSsl } from '@app/common';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: 'apps/admin/.env', quiet: true });
import { StaffUser } from '../staff/entities/staff-user.entity';
import { StaffRefreshToken } from '../auth/entities/staff-refresh-token.entity';
import { StaffDevice } from '../auth/entities/staff-device.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Posting } from '../postings/entities/posting.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.ADMIN_DATABASE_URL,
  ssl: pgSsl(),
  entities: [StaffUser, StaffRefreshToken, StaffDevice, AuditLog, Posting],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
