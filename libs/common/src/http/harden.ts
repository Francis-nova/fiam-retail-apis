import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Baseline HTTP hardening shared by every public API: security headers, no
 * `X-Powered-By`, and `trust proxy` so rate limits and logs see the real
 * client IP (Traefik is the single hop in front of every service).
 */
export function hardenHttp(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
}

/** Swagger exposes the full endpoint map — off in production unless opted in. */
export function swaggerEnabled(env: string): boolean {
  return env !== 'production' || process.env.ENABLE_SWAGGER === 'true';
}
