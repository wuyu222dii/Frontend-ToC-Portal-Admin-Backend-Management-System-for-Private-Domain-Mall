import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { AdminAuditController } from './admin-audit.controller';
import type { AdminAuditService } from './admin-audit.service';

function harness() {
  const service = { list: vi.fn() };
  return {
    controller: new AdminAuditController(service as unknown as AdminAuditService),
    service,
  };
}

describe('AdminAuditController', () => {
  it('requires SUPER_ADMIN and applies no-store', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminAuditController)).toEqual(['SUPER_ADMIN']);
    expect(Reflect.getMetadata(NO_STORE_RESPONSE, AdminAuditController.prototype.list)).toBe(true);
  });

  it('strictly decodes filters before dispatch', () => {
    const { controller, service } = harness();
    controller.list({
      action: 'PUBLISH',
      date_from: '2026-09-04',
      date_to: '2026-09-04',
      page: '2',
      page_size: '50',
      target_type: 'business_rule',
    });

    expect(service.list).toHaveBeenCalledWith({
      action: 'PUBLISH',
      createdAtFrom: new Date('2026-09-03T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-04T16:00:00.000Z'),
      page: 2,
      pageSize: 50,
      targetType: 'business_rule',
    });
    expect(() => controller.list({ unexpected: '1' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
