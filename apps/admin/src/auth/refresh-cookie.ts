import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { map, Observable } from 'rxjs';
import { AdminConfig } from '../config/configuration';

// The refresh token lives in an HttpOnly cookie, never in a response body or
// in script-readable storage: injected JavaScript can't read it, so an XSS bug
// can't steal a long-lived session.
//  - Path=/auth: the browser sends it only to the auth endpoints.
//  - SameSite=Strict: it is never sent on a cross-site request, which is also
//    what protects /auth/refresh from CSRF (console and API are same-site).
//  - Secure in production (HTTPS).
export const REFRESH_COOKIE = 'fiam_console_rt';

const baseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/auth',
});

export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      const value = rest.join('=');
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

/** Moves `refreshToken` out of any JSON body and into the cookie. */
@Injectable()
export class RefreshCookieInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<AdminConfig, true>) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (
          body &&
          typeof body === 'object' &&
          typeof (body as { refreshToken?: unknown }).refreshToken === 'string'
        ) {
          const { refreshToken, ...rest } = body as {
            refreshToken: string;
          } & Record<string, unknown>;
          const ttlDays = this.config.get('jwt', {
            infer: true,
          }).refreshTtlDays;
          res.cookie(REFRESH_COOKIE, refreshToken, {
            ...baseOptions(),
            maxAge: ttlDays * 86_400_000,
          });
          return rest;
        }
        return body;
      }),
    );
  }
}
