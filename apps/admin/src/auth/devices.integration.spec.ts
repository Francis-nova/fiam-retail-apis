import { createHmac } from 'crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as webauthn from '@simplewebauthn/server';
import { DevicesService, MAX_DEVICES_PER_STAFF } from './devices.service';
import { DeviceStatus, StaffDevice } from './entities/staff-device.entity';
import { StaffRefreshToken } from './entities/staff-refresh-token.entity';
import { StaffRole, StaffUser } from '../staff/entities/staff-user.entity';

// The WebAuthn signature check is the library's job; what is ours is the cap,
// the pending/approve flow and revocation, which live in SQL.
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual<typeof webauthn>('@simplewebauthn/server'),
  verifyRegistrationResponse: jest.fn(),
}));

//   ADMIN_TEST_DATABASE_URL=postgres://localhost/scratch npx jest devices.integration
const URL = process.env.ADMIN_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;
const SECRET = 's'.repeat(40);

d('staff devices (Postgres)', () => {
  let ds: DataSource;
  let svc: DevicesService;
  const jwt = new JwtService({ secret: SECRET });
  const audit = { recordSafe: jest.fn() };
  const config = {
    get: (p: string) =>
      p === 'jwt.accessSecret'
        ? SECRET
        : { rpId: 'localhost', origins: ['http://localhost'], required: true },
  };
  let n = 0;
  // A fresh credential per call, so parallel registrations don't collide on id.
  beforeEach(() => {
    (webauthn.verifyRegistrationResponse as jest.Mock).mockImplementation(
      () => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: `cred-${++n}`,
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
        },
      }),
    );
  });

  async function staffMember() {
    const repo = ds.getRepository(StaffUser);
    return repo.save(
      repo.create({
        fullName: 'T',
        email: `s${++n}@fiam.ng`,
        passwordHash: await argon2.hash('x', { type: argon2.argon2id }),
        role: StaffRole.FINANCE,
      }),
    );
  }

  const register = async (
    staff: StaffUser,
    status: DeviceStatus.ACTIVE | DeviceStatus.PENDING,
  ) => {
    const { challengeToken } = await svc.registrationOptions(staff).catch(
      // At the cap the options call refuses first; sign a token to hit the
      // transactional check instead.
      async () => ({
        challengeToken: await jwt.signAsync(
          { sub: staff.id, kind: 'reg', ch: 'c' },
          { secret: challengeSecret() },
        ),
      }),
    );
    return svc.register(
      staff,
      challengeToken,
      {} as never,
      'Laptop',
      status,
      null,
    );
  };

  // Same derivation as DevicesService.challengeSecret().
  const challengeSecret = () =>
    createHmac('sha256', SECRET)
      .update('admin-webauthn-challenge')
      .digest('hex');

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [StaffUser, StaffRefreshToken, StaffDevice],
      dropSchema: true,
      synchronize: true,
    });
    await ds.initialize();
    svc = new DevicesService(
      ds.getRepository(StaffDevice),
      ds.getRepository(StaffUser),
      ds.getRepository(StaffRefreshToken),
      ds,
      jwt,
      config as never,
      audit as never,
    );
  });
  afterAll(() => ds.destroy());

  it('allows 3 devices and refuses the 4th, even in parallel', async () => {
    const staff = await staffMember();
    await register(staff, DeviceStatus.ACTIVE);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => register(staff, DeviceStatus.PENDING)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
      MAX_DEVICES_PER_STAFF - 1,
    );
    expect((await svc.list(staff.id)).length).toBe(MAX_DEVICES_PER_STAFF);
    await expect(register(staff, DeviceStatus.ACTIVE)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('a revoked device frees a slot and cannot be reused', async () => {
    const staff = await staffMember();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await register(staff, DeviceStatus.ACTIVE)).id);
    }
    const actor = { staffId: staff.id, email: staff.email };
    await svc.revoke(staff.id, ids[0], actor, null);
    expect(await svc.isActive(ids[0], staff.id)).toBe(false);
    await register(staff, DeviceStatus.ACTIVE);
    await expect(register(staff, DeviceStatus.ACTIVE)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('pending devices cannot sign in until approved, and only by the owner', async () => {
    const staff = await staffMember();
    const other = await staffMember();
    const { id } = await register(staff, DeviceStatus.PENDING);
    const actor = { staffId: other.id, email: other.email };
    expect(await svc.isActive(id, staff.id)).toBe(false);
    await expect(svc.approve(other.id, id, actor, null)).rejects.toMatchObject({
      status: 404,
    });
    await svc.approve(staff.id, id, actor, null);
    expect(await svc.isActive(id, staff.id)).toBe(true);
    expect(await svc.isActive(id, other.id)).toBe(false);
  });
});
