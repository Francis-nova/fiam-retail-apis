import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '../staff/entities/staff-user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

// Routes a staff member with a temporary password may still call.
export const ALLOW_PASSWORD_CHANGE_KEY = 'allowPasswordChange';
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
