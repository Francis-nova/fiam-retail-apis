import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedStaff } from './current-staff.decorator';
import { ALLOW_PASSWORD_CHANGE_KEY } from './roles.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('admin-jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<T extends AuthenticatedStaff = AuthenticatedStaff>(
    err: unknown,
    user: T,
    info: unknown,
    context: ExecutionContext,
  ): T {
    const authed = super.handleRequest<T>(err, user, info, context);
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed && authed.mustChangePassword) {
      throw new ForbiddenException({
        message: 'Password change required',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    return authed;
  }
}
