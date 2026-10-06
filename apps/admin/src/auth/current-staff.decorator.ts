import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { StaffRole } from '../staff/entities/staff-user.entity';

// A class (not an interface) so it survives emitDecoratorMetadata in
// decorated controller signatures.
export class AuthenticatedStaff {
  staffId: string;
  email: string;
  role: StaffRole;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}

export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff =>
    (
      ctx.switchToHttp().getRequest<Request>() as unknown as {
        user: AuthenticatedStaff;
      }
    ).user,
);

export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null =>
    ctx.switchToHttp().getRequest<Request>().ip ?? null,
);
