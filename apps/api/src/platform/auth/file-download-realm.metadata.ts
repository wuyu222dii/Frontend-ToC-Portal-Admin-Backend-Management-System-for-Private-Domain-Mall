import { applyDecorators, SetMetadata } from '@nestjs/common';

import { RequireRoles } from '../access/rbac.metadata';

export const FILE_DOWNLOAD_AUTHENTICATION = Symbol('file-download-authentication');

export const RequireFileDownloadAuthentication = () => applyDecorators(
  SetMetadata(FILE_DOWNLOAD_AUTHENTICATION, true),
  RequireRoles('CUSTOMER', 'SUPER_ADMIN', 'AGENT_ADMIN'),
);
