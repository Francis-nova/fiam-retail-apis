import { createHmac } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { AdminConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { StaffUser } from '../staff/entities/staff-user.entity';
import { DeviceStatus, StaffDevice } from './entities/staff-device.entity';
import { StaffRefreshToken } from './entities/staff-refresh-token.entity';

export const MAX_DEVICES_PER_STAFF = 3;
const CHALLENGE_TTL = '5m';

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(StaffDevice)
    private readonly devices: Repository<StaffDevice>,
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
    @InjectRepository(StaffRefreshToken)
    private readonly refreshRepo: Repository<StaffRefreshToken>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AdminConfig, true>,
    private readonly audit: AuditService,
  ) {}

  // --- Challenges: signed, short-lived, bound to one staff member -----------
  // Derived secret, so a challenge token never validates as an access/MFA token.
  // shortcut: stateless, so a captured assertion could be replayed inside the
  // 5-minute window, upgrade to a Redis single-use challenge if that matters.

  private challengeSecret() {
    return createHmac(
      'sha256',
      this.config.get('jwt.accessSecret', { infer: true }),
    )
      .update('admin-webauthn-challenge')
      .digest('hex');
  }

  private signChallenge(staffId: string, kind: 'reg' | 'auth', ch: string) {
    return this.jwt.signAsync(
      { sub: staffId, kind, ch },
      { secret: this.challengeSecret(), expiresIn: CHALLENGE_TTL },
    );
  }

  private async readChallenge(token: string, staffId: string, kind: string) {
    try {
      const p = await this.jwt.verifyAsync<{
        sub: string;
        kind: string;
        ch: string;
      }>(token, { secret: this.challengeSecret() });
      if (p.sub === staffId && p.kind === kind) return p.ch;
    } catch {
      // falls through
    }
    throw new UnauthorizedException('Device check expired, please try again');
  }

  private rp() {
    const { rpId, origins } = this.config.get('device', { infer: true });
    return { rpId, origins };
  }

  // --- Reads ----------------------------------------------------------------

  list(staffId: string) {
    return this.devices.find({
      where: { staffId, status: Not(DeviceStatus.REVOKED) },
      select: {
        id: true,
        label: true,
        status: true,
        approvedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      order: { createdAt: 'ASC' },
    });
  }

  /** What the sign-in screen should offer. */
  async state(staffId: string) {
    const rows = await this.devices.find({
      where: { staffId, status: Not(DeviceStatus.REVOKED) },
      select: { status: true },
    });
    return {
      hasActive: rows.some((d) => d.status === DeviceStatus.ACTIVE),
      hasPending: rows.some((d) => d.status === DeviceStatus.PENDING),
      canRegister: rows.length < MAX_DEVICES_PER_STAFF,
    };
  }

  isActive(deviceId: string, staffId: string) {
    return this.devices.existsBy({
      id: deviceId,
      staffId,
      status: DeviceStatus.ACTIVE,
    });
  }

  // --- Registration ---------------------------------------------------------

  async registrationOptions(staff: StaffUser) {
    const existing = await this.devices.find({
      where: { staffId: staff.id, status: Not(DeviceStatus.REVOKED) },
    });
    if (existing.length >= MAX_DEVICES_PER_STAFF) throw this.limitError();
    const { rpId } = this.rp();
    const options = await generateRegistrationOptions({
      rpName: 'Fiam Console',
      rpID: rpId,
      userName: staff.email,
      userID: new TextEncoder().encode(staff.id),
      attestationType: 'none',
      excludeCredentials: existing.map((d) => ({
        id: d.credentialId,
        transports: d.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    return {
      options,
      challengeToken: await this.signChallenge(
        staff.id,
        'reg',
        options.challenge,
      ),
    };
  }

  /**
   * Stores a verified passkey. `status` is ACTIVE when the caller is already
   * signed in from an approved device, PENDING when it came from a sign-in
   * (a super admin must approve it).
   */
  async register(
    staff: StaffUser,
    challengeToken: string,
    response: RegistrationResponseJSON,
    label: string,
    status: DeviceStatus.ACTIVE | DeviceStatus.PENDING,
    ip: string | null,
  ) {
    const expectedChallenge = await this.readChallenge(
      challengeToken,
      staff.id,
      'reg',
    );
    const { rpId, origins } = this.rp();
    let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new BadRequestException('Could not verify this device');
    }
    if (!verified.verified) {
      throw new BadRequestException('Could not verify this device');
    }
    const { credential } = verified.registrationInfo;

    // The cap is enforced under a lock on the staff row, so two parallel
    // registrations can't both slip past a stale count.
    const saved = await this.dataSource.transaction(async (m) => {
      await m
        .createQueryBuilder(StaffUser, 's')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id: staff.id })
        .getOneOrFail();
      const count = await m.countBy(StaffDevice, {
        staffId: staff.id,
        status: Not(DeviceStatus.REVOKED),
      });
      if (count >= MAX_DEVICES_PER_STAFF) throw this.limitError();
      if (await m.existsBy(StaffDevice, { credentialId: credential.id })) {
        throw new ConflictException('This device is already registered');
      }
      return m.save(
        m.create(StaffDevice, {
          staffId: staff.id,
          label: label.trim().slice(0, 60) || 'Unnamed device',
          credentialId: credential.id,
          publicKey: b64(credential.publicKey),
          counter: String(credential.counter),
          transports: credential.transports ?? [],
          status,
          approvedBy: status === DeviceStatus.ACTIVE ? staff.id : null,
          approvedAt: status === DeviceStatus.ACTIVE ? new Date() : null,
        }),
      );
    });
    await this.audit.recordSafe({
      staffId: staff.id,
      staffEmail: staff.email,
      action:
        status === DeviceStatus.ACTIVE
          ? 'auth.device_added'
          : 'auth.device_requested',
      resourceId: saved.id,
      ip,
      metadata: { label: saved.label },
    });
    return { id: saved.id, status: saved.status };
  }

  // --- Sign-in --------------------------------------------------------------

  async authenticationOptions(staffId: string) {
    const active = await this.devices.find({
      where: { staffId, status: DeviceStatus.ACTIVE },
    });
    if (!active.length) {
      throw new BadRequestException('No approved device on this account');
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rp().rpId,
      userVerification: 'required',
      allowCredentials: active.map((d) => ({
        id: d.credentialId,
        transports: d.transports as AuthenticatorTransport[],
      })),
    });
    return {
      options,
      challengeToken: await this.signChallenge(
        staffId,
        'auth',
        options.challenge,
      ),
    };
  }

  /** Verifies the passkey; returns the approved device that signed. */
  async authenticate(
    staffId: string,
    challengeToken: string,
    response: AuthenticationResponseJSON,
  ) {
    const expectedChallenge = await this.readChallenge(
      challengeToken,
      staffId,
      'auth',
    );
    const device = await this.devices.findOne({
      where: {
        credentialId: response.id,
        staffId,
        status: DeviceStatus.ACTIVE,
      },
    });
    const invalid = new UnauthorizedException('This device is not approved');
    if (!device) throw invalid;
    const { rpId, origins } = this.rp();
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: device.credentialId,
          publicKey: unb64(device.publicKey),
          counter: Number(device.counter),
          transports: device.transports,
        },
      });
    } catch {
      throw invalid;
    }
    if (!verified.verified) throw invalid;
    await this.devices.update(device.id, {
      counter: String(verified.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    });
    return device;
  }

  // --- Management -----------------------------------------------------------

  async approve(
    staffId: string,
    deviceId: string,
    actor: { staffId: string; email: string },
    ip: string | null,
  ) {
    const res = await this.devices.update(
      { id: deviceId, staffId, status: DeviceStatus.PENDING },
      {
        status: DeviceStatus.ACTIVE,
        approvedBy: actor.staffId,
        approvedAt: new Date(),
      },
    );
    if (!res.affected) throw new NotFoundException('No pending device found');
    await this.audit.recordSafe({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'auth.device_approved',
      resourceId: deviceId,
      ip,
      metadata: { ownerId: staffId },
    });
  }

  /** Revokes a device and signs out every session that came from it. */
  async revoke(
    staffId: string,
    deviceId: string,
    actor: { staffId: string; email: string },
    ip: string | null,
  ) {
    const res = await this.devices.update(
      {
        id: deviceId,
        staffId,
        status: In([DeviceStatus.ACTIVE, DeviceStatus.PENDING]),
      },
      { status: DeviceStatus.REVOKED },
    );
    if (!res.affected) throw new NotFoundException('Device not found');
    await this.refreshRepo.update(
      { deviceId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.audit.recordSafe({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'auth.device_revoked',
      resourceId: deviceId,
      ip,
      metadata: { ownerId: staffId },
    });
  }

  private limitError() {
    return new ConflictException(
      `You can register at most ${MAX_DEVICES_PER_STAFF} devices. Remove one first.`,
    );
  }
}
