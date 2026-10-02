// Usage (from apis/): SEED_EMAIL=you@fiam.ng SEED_NAME="Your Name" \
//   npm run seed:admin
// Prints a one-time temporary password; the account must change it on first
// sign-in. No-op (exits non-zero) if the email already exists.
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { AppDataSource } from '../src/database/data-source';
import { StaffRole, StaffUser } from '../src/staff/entities/staff-user.entity';

async function main() {
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();
  const fullName = process.env.SEED_NAME?.trim() || 'Super Admin';
  if (!email) throw new Error('SEED_EMAIL is required');

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(StaffUser);
  if (await repo.existsBy({ email })) {
    throw new Error(`Staff user ${email} already exists`);
  }
  const temporaryPassword = randomBytes(12).toString('base64url');
  await repo.save(
    repo.create({
      fullName,
      email,
      role: StaffRole.SUPER_ADMIN,
      passwordHash: await argon2.hash(temporaryPassword, {
        type: argon2.argon2id,
      }),
      mustChangePassword: true,
    }),
  );
  console.log(
    `Created SUPER_ADMIN ${email}\nTemporary password: ${temporaryPassword}`,
  );
  await AppDataSource.destroy();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
