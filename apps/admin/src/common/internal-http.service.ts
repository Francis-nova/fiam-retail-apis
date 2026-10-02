import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminConfig } from '../config/configuration';

export type InternalService = 'auth' | 'payment';

// Calls another Fiam service's /internal routes (shared-secret
// `x-internal-key`). Every console *write* goes through here rather than
// into that service's database, so its own rules apply.
//
// Failures are deliberately distinguishable: an HTTP error from the service
// is rethrown with its status (a definite answer), while an unreachable
// service or a timeout is a 503 (the outcome is unknown — it may or may not
// have applied the request), so callers that move money can tell them apart.
@Injectable()
export class InternalHttp {
  constructor(private readonly config: ConfigService<AdminConfig, true>) {}

  async call<T>(
    service: InternalService,
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const services = this.config.get('services', { infer: true });
    const baseUrl = service === 'auth' ? services.authUrl : services.paymentUrl;
    if (!services.internalApiKey) {
      throw new ServiceUnavailableException(
        'INTERNAL_API_KEY is not configured for the admin service',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/internal${path}`, {
        method,
        headers: {
          'x-internal-key': services.internalApiKey,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        `The ${service} service is unreachable`,
      );
    }
    const data = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    if (!res.ok) {
      const message = Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message;
      throw new HttpException(
        message ?? `${service} service error`,
        res.status,
      );
    }
    return data as T;
  }

  // GET a binary body (e.g. a stored KYC document) from an /internal route.
  async getFile(
    service: InternalService,
    path: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const services = this.config.get('services', { infer: true });
    const baseUrl = service === 'auth' ? services.authUrl : services.paymentUrl;
    if (!services.internalApiKey) {
      throw new ServiceUnavailableException(
        'INTERNAL_API_KEY is not configured for the admin service',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/internal${path}`, {
        headers: { 'x-internal-key': services.internalApiKey },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        `The ${service} service is unreachable`,
      );
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      throw new HttpException(
        data.message ?? `${service} service error`,
        res.status,
      );
    }
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType:
        res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
}
