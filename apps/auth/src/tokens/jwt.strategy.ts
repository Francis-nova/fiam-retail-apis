import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IsNull, Repository } from 'typeorm';
import { AuthConfig } from '../config/configuration';
import { Session } from '../sessions/entities/session.entity';

export interface JwtPayload {
  sub: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AuthConfig, true>,
    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  // A JWT's signature alone stays valid for its whole TTL even after its
  // session is revoked (e.g. by a login from another device enforcing
  // "one session per customer") — checking the session row here, on every
  // request, is what makes revocation take effect immediately instead of
  // up to ~15 minutes later. Also doubles as the "monitor sessions"
  // heartbeat: lastSeenAt is refreshed on every authenticated call.
  async validate(payload: JwtPayload) {
    const session = await this.sessionsRepo.findOne({
      where: { id: payload.sid, revokedAt: IsNull() },
    });
    if (!session) {
      // Distinct `code` (not just the 401 status) so the client can tell
      // "your session was invalidated — sign in again" apart from an
      // in-app 401 like a wrong PIN on an otherwise-valid session, which
      // must NOT log the customer out.
      throw new UnauthorizedException({
        message: 'Session no longer active',
        code: 'SESSION_REVOKED',
      });
    }
    await this.sessionsRepo.update(session.id, { lastSeenAt: new Date() });
    return { userId: payload.sub, sessionId: payload.sid };
  }
}
