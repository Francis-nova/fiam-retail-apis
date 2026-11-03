import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { AdminConfig } from '../config/configuration';
import { StaffStatus, StaffUser } from '../staff/entities/staff-user.entity';
import { AuthenticatedStaff } from './current-staff.decorator';
import { DevicesService } from './devices.service';

export interface StaffJwtPayload {
  sub: string;
  did?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  private readonly deviceRequired: boolean;

  constructor(
    configService: ConfigService<AdminConfig, true>,
    @InjectRepository(StaffUser)
    private readonly staffRepo: Repository<StaffUser>,
    private readonly devices: DevicesService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
    this.deviceRequired = configService.get('device.required', { infer: true });
  }

  // Re-reads the staff row on every request so disabling an account or
  // changing its role takes effect immediately, not when the token expires.
  async validate(payload: StaffJwtPayload): Promise<AuthenticatedStaff> {
    const staff = await this.staffRepo.findOne({ where: { id: payload.sub } });
    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    // Device lock: the session must come from a device that is still approved,
    // so revoking a device cuts its live sessions immediately.
    if (
      this.deviceRequired &&
      !(payload.did && (await this.devices.isActive(payload.did, staff.id)))
    ) {
      throw new UnauthorizedException();
    }
    return {
      staffId: staff.id,
      deviceId: payload.did ?? null,
      email: staff.email,
      role: staff.role,
      mustChangePassword: staff.mustChangePassword,
      twoFactorEnabled: !!staff.totpEnabledAt,
    };
  }
}
