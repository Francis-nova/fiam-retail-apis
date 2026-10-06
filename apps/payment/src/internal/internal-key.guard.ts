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
import { PaymentConfig } from '../config/configuration';

// Service-to-service auth for /internal/* — the same shared INTERNAL_API_KEY
// the auth service uses, sent in `x-internal-key`. These routes must never be
// reachable from the internet (exclude /internal at the proxy).
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const { internalApiKey } = this.configService.get('auth', { infer: true });
    if (!internalApiKey) {
      throw new ServiceUnavailableException(
        'Internal API is not configured (missing INTERNAL_API_KEY)',
      );
    }
    const header = context.switchToHttp().getRequest<Request>().headers[
      'x-internal-key'
    ];
    const provided = typeof header === 'string' ? header : '';
    const a = Buffer.from(provided);
    const b = Buffer.from(internalApiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
