import { Injectable } from '@nestjs/common';
import { InternalHttp } from '../common/internal-http.service';

// Customer writes go to the auth service's /internal routes.
@Injectable()
export class AuthClient {
  constructor(private readonly http: InternalHttp) {}

  call<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.http.call<T>('auth', method, path, body);
  }

  file(path: string) {
    return this.http.getFile('auth', path);
  }
}
