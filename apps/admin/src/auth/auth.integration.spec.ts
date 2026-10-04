import * as OTPAuth from 'otpauth';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { StaffRefreshToken } from './entities/staff-refresh-token.entity';
import { StaffRole, StaffUser } from '../staff/entities/staff-user.entity';

// Real-Postgres test of the sign-in security properties, which live in SQL
// (atomic attempt counting, TOTP replay, single-use recovery codes). Runs only
// when ADMIN_TEST_DATABASE_URL points at a scratch database.
//   docker run -d -p 55434:5432 -e POSTGRES_PASSWORD=x postgres:17-alpine
//   ADMIN_TEST_DATABASE_URL=postgres://postgres:x@localhost:55434/postgres npx jest auth.integration
const URL = process.env.ADMIN_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

const SECRET = 's'.repeat(40);
const PASSWORD = 'correct-horse-battery';

d('staff sign-in with 2FA (Postgres)', () => {
  let ds: DataSource;
  let totpCfg = {
    encryptionKey: 'b'.repeat(64),
    issuer: 'Test',
    required: false,
  };
  const audit = { recordSafe: jest.fn(), record: jest.fn() };
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '15m' },
  });
  // Resolves dotted paths ('jwt.accessSecret') like the real ConfigService.
  const config = {
    get: (path: string) =>
      path
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], {
          jwt: { accessSecret: SECRET, accessTtl: '15m', refreshTtlDays: 7 },
          totp: totpCfg,
        }),
  };
  let svc: AuthService;
  let totp: TotpService;

  const codeFor = (secret: string, steps = 0) =>
    new OTPAuth.TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate({ timestamp: Date.now() + steps * 30_000 });

  async function newStaff(email: string) {
    const repo = ds.getRepository(StaffUser);
    return repo.save(
      repo.create({
        fullName: 'Test Person',
        email,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        role: StaffRole.FINANCE,
        mustChangePassword: false,
      }),
    );
  }

  // Enrols the account the way a person would, returning the secret.
  async function enrol(email: string) {
    const staff = await newStaff(email);
    const { secret } = await svc.startEnrollment(staff.id);
    const { recoveryCodes } = await svc.confirmEnrollment(
      staff.id,
      codeFor(secret),
      null,
    );
    return { staff, secret, recoveryCodes };
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [StaffUser, StaffRefreshToken],
      dropSchema: true, // scratch database: the test owns its schema
      synchronize: true,
    });
    await ds.initialize();
    totp = new TotpService(config as never);
    svc = new AuthService(
      ds.getRepository(StaffUser),
      ds.getRepository(StaffRefreshToken),
      jwt,
      config as never,
      audit as never,
      totp,
    );
  });
  afterAll(() => ds.destroy());
  beforeEach(() => {
    totpCfg = { ...totpCfg, required: false };
    jest.clearAllMocks();
  });

  it('signs in with just a password when 2FA is neither enrolled nor required', async () => {
    await newStaff('plain@fiam.ng');
    const res = await svc.login('plain@fiam.ng', PASSWORD, null);
    expect(res).toHaveProperty('accessToken');
  });

  it('demands a second step when enrolled, and the mfaToken is useless as an access token', async () => {
    const { secret } = await enrol('enrolled@fiam.ng');
    const step1 = await svc.login('enrolled@fiam.ng', PASSWORD, null);
    expect(step1).toMatchObject({ mfa: 'verify' });
    expect(step1).not.toHaveProperty('accessToken');
    const { mfaToken } = step1 as { mfaToken: string };
    await expect(jwt.verifyAsync(mfaToken)).rejects.toBeTruthy();
    const done = await svc.verifyMfa(mfaToken, codeFor(secret, 1), null);
    expect(done).toHaveProperty('accessToken');
  });

  it('refuses a TOTP code that was already used (replay)', async () => {
    const { secret } = await enrol('replay@fiam.ng');
    const code = codeFor(secret, 1); // ahead of the enrolment step
    const t1 = (await svc.login('replay@fiam.ng', PASSWORD, null)) as {
      mfaToken: string;
    };
    await svc.verifyMfa(t1.mfaToken, code, null);
    const t2 = (await svc.login('replay@fiam.ng', PASSWORD, null)) as {
      mfaToken: string;
    };
    await expect(svc.verifyMfa(t2.mfaToken, code, null)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('lets only 5 attempts through a burst of parallel wrong codes, then locks', async () => {
    await enrol('burst@fiam.ng');
    const t = (await svc.login('burst@fiam.ng', PASSWORD, null)) as {
      mfaToken: string;
    };
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        svc.verifyMfa(t.mfaToken, '000000', null),
      ),
    );
    const status = (r: PromiseSettledResult<unknown>) =>
      r.status === 'rejected' ? (r.reason as { status: number }).status : 200;
    const wrong = results.filter((r) => status(r) === 401).length;
    const locked = results.filter((r) => status(r) === 429).length;
    // 1 attempt was spent on the password, so 4 wrong codes fit before the lock.
    expect(wrong).toBe(4);
    expect(locked).toBe(36);
    await expect(
      svc.login('burst@fiam.ng', PASSWORD, null),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  it('a correct password does not refresh the budget for guessing codes', async () => {
    await enrol('budget@fiam.ng');
    // Alternate correct-password / wrong-code. Every call is one reservation, so
    // the lock must land on the 5th and the 6th call must be refused outright.
    const outcomes: number[] = [];
    const status = (e: unknown) => (e as { status: number }).status;
    for (let i = 0; i < 3; i++) {
      let token = '';
      try {
        token = (
          (await svc.login('budget@fiam.ng', PASSWORD, null)) as {
            mfaToken: string;
          }
        ).mfaToken;
        outcomes.push(200);
      } catch (e) {
        outcomes.push(status(e));
        continue;
      }
      await svc.verifyMfa(token, '000000', null).then(
        () => outcomes.push(200),
        (e) => outcomes.push(status(e)),
      );
    }
    expect(outcomes).toEqual([200, 401, 200, 401, 200, 429]);
  });

  it('accepts each recovery code exactly once', async () => {
    const { recoveryCodes } = await enrol('recover@fiam.ng');
    const t1 = (await svc.login('recover@fiam.ng', PASSWORD, null)) as {
      mfaToken: string;
    };
    expect(
      await svc.verifyMfa(t1.mfaToken, recoveryCodes[0].toUpperCase(), null),
    ).toHaveProperty('accessToken');
    const t2 = (await svc.login('recover@fiam.ng', PASSWORD, null)) as {
      mfaToken: string;
    };
    await expect(
      svc.verifyMfa(t2.mfaToken, recoveryCodes[0], null),
    ).rejects.toMatchObject({
      status: 401,
    });
    // A different unused one still works.
    expect(
      await svc.verifyMfa(t2.mfaToken, recoveryCodes[1], null),
    ).toHaveProperty('accessToken');
  });

  it('forces enrolment when 2FA is required, then signs in with recovery codes issued', async () => {
    totpCfg = { ...totpCfg, required: true };
    await newStaff('forced@fiam.ng');
    const step1 = (await svc.login('forced@fiam.ng', PASSWORD, null)) as {
      mfa: string;
      mfaToken: string;
    };
    expect(step1.mfa).toBe('enroll');
    // The wrong token type can't be used for the wrong step.
    await expect(
      svc.verifyMfa(step1.mfaToken, '123456', null),
    ).rejects.toMatchObject({ status: 401 });
    const { secret } = await svc.startEnrollmentWithToken(step1.mfaToken);
    await expect(
      svc.confirmEnrollmentWithToken(step1.mfaToken, '000000', null),
    ).rejects.toMatchObject({ status: 401 });
    const done = await svc.confirmEnrollmentWithToken(
      step1.mfaToken,
      codeFor(secret),
      null,
    );
    expect(done).toHaveProperty('accessToken');
    expect(done.recoveryCodes).toHaveLength(10);
    expect(done.staff.twoFactorEnabled).toBe(true);
  });

  it('refuses to disable 2FA when required, and needs password + code otherwise', async () => {
    const { staff, secret } = await enrol('disable@fiam.ng');
    totpCfg = { ...totpCfg, required: true };
    await expect(
      svc.disableTwoFactor(staff.id, PASSWORD, codeFor(secret, 1), null),
    ).rejects.toMatchObject({ status: 403 });
    totpCfg = { ...totpCfg, required: false };
    await expect(
      svc.disableTwoFactor(
        staff.id,
        'wrong-password-here',
        codeFor(secret, 1),
        null,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await svc.disableTwoFactor(staff.id, PASSWORD, codeFor(secret, 1), null);
    const after = await ds
      .getRepository(StaffUser)
      .findOneByOrFail({ id: staff.id });
    expect(after.totpEnabledAt).toBeNull();
    expect(after.totpSecretEnc).toBeNull();
    expect(after.recoveryCodeHashes).toEqual([]);
  });
});
