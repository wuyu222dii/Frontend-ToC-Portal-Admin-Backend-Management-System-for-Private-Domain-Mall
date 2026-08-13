export const ACCOUNT_ROLES = ['SUPER_ADMIN', 'AGENT_ADMIN', 'CUSTOMER'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const SESSION_ASSURANCES = ['WECHAT', 'PASSWORD', 'MFA'] as const;
export type SessionAssurance = (typeof SESSION_ASSURANCES)[number];

export const SESSION_RESTRICTIONS = ['NONE', 'CHANGE_PASSWORD_ONLY'] as const;
export type SessionRestriction = (typeof SESSION_RESTRICTIONS)[number];

export type Permission = string;

export interface RbacPrincipal {
  accountId: string;
  sessionId: string;
  role: AccountRole;
  permissions: readonly Permission[];
  assurance: SessionAssurance;
  restriction: SessionRestriction;
}

export function hasRole(principal: RbacPrincipal, roles: readonly AccountRole[]): boolean {
  return roles.includes(principal.role);
}

export function hasPermission(principal: RbacPrincipal, permission: Permission): boolean {
  return principal.permissions.includes(permission);
}

export function hasAllPermissions(principal: RbacPrincipal, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(principal, permission));
}
