// Break-glass device management, run on the server by whoever holds database
// access (the in-console approval needs a signed-in super admin, so this is
// the way back in after losing every device).
//   npm run device:admin -- approve you@fiam.ng   approve their pending device(s)
//   npm run device:admin -- reset   you@fiam.ng   revoke ALL their devices + sessions
// Staging/prod: run the compiled copy as a one-shot job like seed-super-admin.
import { IsNull } from 'typeorm';
import { AppDataSource } from './data-source';
import { StaffUser } from '../staff/entities/staff-user.entity';
import {
  DeviceStatus,
  StaffDevice,
} from '../auth/entities/staff-device.entity';
import { StaffRefreshToken } from '../auth/entities/staff-refresh-token.entity';

async function main() {
  const [action, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!['approve', 'reset'].includes(action) || !email) {
    throw new Error('Usage: device-admin <approve|reset> <staff-email>');
  }
  await AppDataSource.initialize();
  const staff = await AppDataSource.getRepository(StaffUser).findOneBy({
    email,
  });
  if (!staff) throw new Error(`No staff user ${email}`);
  const devices = AppDataSource.getRepository(StaffDevice);

  if (action === 'approve') {
    const res = await devices.update(
      { staffId: staff.id, status: DeviceStatus.PENDING },
      { status: DeviceStatus.ACTIVE, approvedAt: new Date() },
    );
    console.log(`Approved ${res.affected ?? 0} pending device(s) for ${email}`);
  } else {
    const res = await devices.update(
      { staffId: staff.id },
      { status: DeviceStatus.REVOKED },
    );
    await AppDataSource.getRepository(StaffRefreshToken).update(
      { staffId: staff.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    console.log(`Revoked ${res.affected ?? 0} device(s) for ${email}`);
  }
  await AppDataSource.destroy();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
