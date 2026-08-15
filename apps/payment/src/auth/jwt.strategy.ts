import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PaymentConfig } from '../config/configuration';

export interface JwtPayload {
  sub: string;
  sid: string;
}

// Verifies the same tokens apps/auth issues (shared JWT_ACCESS_SECRET) —
// signature + expiry only. Deliberately does NOT check session revocation
// the way auth's own JwtStrategy does (apps/auth/src/tokens/jwt.strategy.ts)
// since payment has no sessions table and no reason to duplicate one just
// for this: a token revoked by e.g. a login on another device stays valid
// against payment's read-only wallet endpoint for up to its ~15min TTL.
// Acceptable trade-off for a balance-read endpoint; would need revisiting
// before payment ever gates a money-movement action on this guard.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<PaymentConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: JwtPayload) {
    return { userId: payload.sub, sessionId: payload.sid };
  }
}
