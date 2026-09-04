import { Inject, Injectable, Optional } from '@nestjs/common';
import { AuditLogRepository, type DatabaseRuntime } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';

import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { AdminAuditListQuery } from './admin-audit.dto';

@Injectable()
export class AdminAuditService {
  private readonly audits?: AuditLogRepository;

  constructor(@Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime) {
    if (database) this.audits = new AuditLogRepository(database.prisma);
  }

  async list(input: AdminAuditListQuery) {
    if (!this.audits) throw new ApplicationError('INTERNAL_ERROR', 'Admin audit repository is unavailable');
    const result = await this.audits.list(input);
    return {
      items: result.items.map((item) => ({
        action: item.action,
        actor_account_id: item.actorAccountId,
        actor_role: item.actorRole,
        after_summary: item.afterSummary.map((summary) => ({
          display_value: summary.displayValue,
          field: summary.field,
          sensitive: summary.sensitive,
        })),
        after_version: item.afterVersion,
        audit_id: item.auditId,
        before_summary: item.beforeSummary.map((summary) => ({
          display_value: summary.displayValue,
          field: summary.field,
          sensitive: summary.sensitive,
        })),
        before_version: item.beforeVersion,
        created_at: item.createdAt.toISOString(),
        idempotency_key: item.idempotencyKey,
        ip_hash: item.ipHash,
        module: item.module,
        reason: item.reason,
        request_id: item.requestId,
        result: item.result,
        result_code: item.resultCode,
        target_id: item.targetId,
        target_type: item.targetType,
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }
}
