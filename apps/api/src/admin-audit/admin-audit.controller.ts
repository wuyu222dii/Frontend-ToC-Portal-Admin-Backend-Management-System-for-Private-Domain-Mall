import { Controller, Get, Inject, Query } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseAdminAuditListQuery } from './admin-audit.dto';
import { AdminAuditService } from './admin-audit.service';

@Controller('admin/audit-logs')
@RequireRoles('SUPER_ADMIN')
export class AdminAuditController {
  constructor(@Inject(AdminAuditService) private readonly audits: AdminAuditService) {}

  @Get() @NoStore()
  list(@Query() query: unknown) {
    return this.audits.list(parseAdminAuditListQuery(query));
  }
}
