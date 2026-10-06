import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedStaff } from './current-staff.decorator';
import { ROLES_KEY } from './roles.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest<{
      user: AuthenticatedStaff;
    }>();
    // SUPER_ADMIN passes every role check.
    if (user.role === StaffRole.SUPER_ADMIN || required.includes(user.role)) {
      return true;
    }
    throw new ForbiddenException('Insufficient role for this action');
  }
}
