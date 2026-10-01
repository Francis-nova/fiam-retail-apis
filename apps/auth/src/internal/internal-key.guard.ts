import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthConfig } from '../config/configuration';

// Service-to-service auth for /internal/* — a shared secret (INTERNAL_API_KEY)
// sent in `x-internal-key`. These routes are never meant to be reachable from
// the internet (the Traefik router excludes /internal), so this is a second
// layer, not the only one.
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const { apiKey } = this.configService.get('internal', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Internal API is not configured (missing INTERNAL_API_KEY)',
      );
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-internal-key'];
    const provided = typeof header === 'string' ? header : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
