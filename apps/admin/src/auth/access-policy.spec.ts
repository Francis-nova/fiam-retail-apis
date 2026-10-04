/* eslint-disable @typescript-eslint/unbound-method -- reading decorator metadata off prototype methods */
import {
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { CustomersController } from '../customers/customers.controller';
import { PostingsController } from '../postings/postings.controller';
import { StaffController } from '../staff/staff.controller';
import { AuditController } from '../audit/audit.controller';
import { TransactionsController } from '../transactions/transactions.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DeletionRequestsController } from '../deletion-requests/deletion-requests.controller';

const R = StaffRole;
const reflector = new Reflector();

type Route = { method: string; path: string; roles?: StaffRole[] };

// Every route of a controller with the roles that apply (route > class).
function routes(controller: new (...a: never[]) => unknown): Route[] {
  const proto = controller.prototype as Record<string, unknown>;
  const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as
    StaffRole[] | undefined;
  return Object.getOwnPropertyNames(proto)
    .filter(
      (n) =>
        typeof proto[n] === 'function' &&
        Reflect.hasMetadata(METHOD_METADATA, proto[n] as object),
    )
    .map((n) => {
      const handler = proto[n] as object;
      return {
        method:
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as number
          ],
        path: String(Reflect.getMetadata(PATH_METADATA, handler)),
        roles:
          (Reflect.getMetadata(ROLES_KEY, handler) as
            StaffRole[] | undefined) ?? classRoles,
      };
    });
}

const CONTROLLERS = [
  CustomersController,
  PostingsController,
  StaffController,
  AuditController,
  TransactionsController,
  DashboardController,
  DeletionRequestsController,
];

describe('admin API access policy', () => {
  it.each(CONTROLLERS.map((c) => [c.name, c]))(
    '%s: JwtAuthGuard and RolesGuard are applied',
    (_n, c) => {
      const guards =
        (Reflect.getMetadata(GUARDS_METADATA, c) as unknown[]) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
    },
  );

  it('no route in a protected controller is open to every signed-in staff member', () => {
    for (const c of CONTROLLERS) {
      for (const r of routes(c)) {
        expect({
          controller: c.name,
          route: `${r.method} ${r.path}`,
          hasRoles: !!r.roles?.length,
        }).toEqual({
          controller: c.name,
          route: `${r.method} ${r.path}`,
          hasRoles: true,
        });
      }
    }
  });

  // The routes that matter most, spelled out so loosening one is a visible diff.
  const expected: [
    new (...a: never[]) => unknown,
    string,
    string,
    StaffRole[],
  ][] = [
    [PostingsController, 'POST', '/', [R.FINANCE]],
    [PostingsController, 'POST', ':id/approve', [R.COMPLIANCE]],
    [PostingsController, 'POST', ':id/reject', [R.COMPLIANCE]],
    [PostingsController, 'POST', ':id/cancel', [R.FINANCE]],
    [StaffController, 'POST', '/', [R.SUPER_ADMIN]],
    [StaffController, 'POST', ':id/reset-password', [R.SUPER_ADMIN]],
    [StaffController, 'POST', ':id/reset-2fa', [R.SUPER_ADMIN]],
    [StaffController, 'DELETE', ':id', [R.SUPER_ADMIN]],
    [AuditController, 'GET', '/', [R.SUPER_ADMIN, R.COMPLIANCE]],
    [CustomersController, 'POST', ':id/suspend', [R.SUPER_ADMIN, R.COMPLIANCE]],
    [CustomersController, 'POST', ':id/close', [R.SUPER_ADMIN, R.COMPLIANCE]],
    [
      CustomersController,
      'POST',
      ':id/tier-upgrade/approve',
      [R.SUPER_ADMIN, R.COMPLIANCE],
    ],
    [
      CustomersController,
      'GET',
      ':id/kyc-documents/:docId/file',
      [R.SUPER_ADMIN, R.COMPLIANCE],
    ],
    [
      CustomersController,
      'POST',
      ':id/clear-lockouts',
      [R.SUPPORT, R.COMPLIANCE],
    ],
    [DeletionRequestsController, 'POST', ':id/approve', [R.COMPLIANCE]],
  ];
  it.each(expected.map((e) => [e[0].name, e[1], e[2], e[3]] as const))(
    '%s %s %s requires exactly %j',
    (name, method, path, roles) => {
      const c = expected.find(
        (e) => e[0].name === name && e[1] === method && e[2] === path,
      )![0];
      const r = routes(c as never).find(
        (x) => x.method === method && x.path === path,
      );
      expect(r).toBeDefined();
      expect([...(r!.roles ?? [])].sort()).toEqual([...roles].sort());
    },
  );
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(reflector);
  const run = (role: StaffRole, required: StaffRole[] | undefined) => {
    class T {
      handler() {}
    }
    if (required)
      Reflect.defineMetadata(ROLES_KEY, required, T.prototype.handler);
    const ctx = {
      getHandler: () => T.prototype.handler,
      getClass: () => T,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    };
    return () => guard.canActivate(ctx as never);
  };

  it('lets SUPER_ADMIN through everything', () => {
    for (const required of [[R.FINANCE], [R.COMPLIANCE], [R.SUPPORT]])
      expect(run(R.SUPER_ADMIN, required)()).toBe(true);
  });
  it('allows a listed role and blocks everyone else', () => {
    expect(run(R.FINANCE, [R.FINANCE, R.COMPLIANCE])()).toBe(true);
    expect(run(R.SUPPORT, [R.FINANCE, R.COMPLIANCE])).toThrow(
      /Insufficient role/,
    );
    expect(run(R.COMPLIANCE, [R.FINANCE])).toThrow(/Insufficient role/);
  });
  it('finance cannot approve and compliance cannot request (separation of duties)', () => {
    expect(run(R.FINANCE, [R.COMPLIANCE])).toThrow();
    expect(run(R.COMPLIANCE, [R.FINANCE])).toThrow();
  });
});
