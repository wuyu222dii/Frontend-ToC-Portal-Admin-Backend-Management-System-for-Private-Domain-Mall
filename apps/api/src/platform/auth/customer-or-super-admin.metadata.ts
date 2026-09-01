import { applyDecorators, SetMetadata } from '@nestjs/common';

import { RequireRoles } from '../access/rbac.metadata';

export const CUSTOMER_OR_SUPER_ADMIN = Symbol('customer-or-super-admin');

export const RequireCustomerOrSuperAdmin = () => applyDecorators(
  SetMetadata(CUSTOMER_OR_SUPER_ADMIN, true),
  RequireRoles('CUSTOMER', 'SUPER_ADMIN'),
);
