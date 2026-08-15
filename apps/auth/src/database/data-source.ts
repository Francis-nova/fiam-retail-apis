import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Each app now owns its own .env (apps/<app>/.env) rather than a shared
// root one — the CLI (invoked from the apis/ root, see package.json's
// migration:*:auth scripts) needs pointing at this app's specifically.
config({ path: 'apps/auth/.env', quiet: true });
import { User } from '../users/entities/user.entity';
import { Session } from '../sessions/entities/session.entity';
import { RefreshToken } from '../tokens/entities/refresh-token.entity';
import { PasswordResetToken } from '../tokens/entities/password-reset-token.entity';
import { Otp } from '../otp/entities/otp.entity';
import { TrustedDevice } from '../devices/entities/trusted-device.entity';
import { PendingLogin } from '../auth/entities/pending-login.entity';
import { KycDocument } from '../kyc/entities/kyc-document.entity';

// Standalone DataSource used by the TypeORM CLI (migration:generate / migration:run).
// Kept separate from database.module.ts's ConfigService-driven setup since the CLI
// runs outside the Nest DI container.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.AUTH_DATABASE_URL,
  entities: [
    User,
    Session,
    RefreshToken,
    PasswordResetToken,
    Otp,
    TrustedDevice,
    PendingLogin,
    KycDocument,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
