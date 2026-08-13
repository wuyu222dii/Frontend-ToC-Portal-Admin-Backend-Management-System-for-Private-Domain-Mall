import { SetMetadata } from '@nestjs/common';
import type { AccountRole, Permission } from '@qingxu/platform-core';

export const PUBLIC_ROUTE = Symbol('public-route');
export const REQUIRED_ROLES = Symbol('required-roles');
export const REQUIRED_PERMISSIONS = Symbol('required-permissions');

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

function requireNonEmptyUnique(values: readonly string[], label: string): void {
  if (values.length === 0) throw new TypeError(`${label} must not be empty`);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicates`);
}

export const RequireRoles = (...roles: readonly AccountRole[]) => {
  requireNonEmptyUnique(roles, 'Required roles');
  return SetMetadata(REQUIRED_ROLES, roles);
};

export const RequirePermissions = (...permissions: readonly Permission[]) => {
  requireNonEmptyUnique(permissions, 'Required permissions');
  if (permissions.some((permission) => !/^[A-Z][A-Z0-9_.:-]{0,79}$/.test(permission))) {
    throw new TypeError('Required permissions contain an invalid value');
  }
  return SetMetadata(REQUIRED_PERMISSIONS, permissions);
};
