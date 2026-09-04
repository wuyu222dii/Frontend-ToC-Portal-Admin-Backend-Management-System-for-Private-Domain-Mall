import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { AdminSettingsController } from './admin-settings.controller';
import type { AdminSettingsService } from './admin-settings.service';

const request = {
  accessSession: { sessionId: generateUlid() },
  principal: { accountId: generateUlid(), role: 'SUPER_ADMIN' },
  requestId: `req_${'1'.repeat(32)}`,
} as unknown as AdminCatalogRequestContext;

function harness() {
  const service = {
    getBusinessRules: vi.fn(),
    previewBusinessRules: vi.fn(),
    publishBusinessRules: vi.fn(),
  };
  return {
    controller: new AdminSettingsController(service as unknown as AdminSettingsService),
    service,
  };
}

describe('AdminSettingsController', () => {
  it('requires SUPER_ADMIN and applies no-store to all operations', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminSettingsController)).toEqual(['SUPER_ADMIN']);
    for (const handler of [
      AdminSettingsController.prototype.get,
      AdminSettingsController.prototype.preview,
      AdminSettingsController.prototype.publish,
    ]) expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
  });

  it('strictly decodes preview and confirmation requests before dispatch', () => {
    const { controller, service } = harness();
    controller.preview({}, {
      changes: { aftersale_window_days: 14 },
      reason: 'Extend aftersale window',
    }, 'preview-key', request);
    controller.publish({}, {
      changes: { minimum_withdrawal_amount: '200.00' },
      confirmation_hash: 'a'.repeat(64),
      preview_token: 'pvw_0123456789abcdef',
      reason: 'Raise withdrawal minimum',
    }, 3, 'confirm-key', request);

    expect(service.previewBusinessRules).toHaveBeenCalledWith(
      request,
      { changes: { aftersaleWindowDays: 14 }, reason: 'Extend aftersale window' },
      'preview-key',
    );
    expect(service.publishBusinessRules).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ changes: { minimumWithdrawalAmount: '200.00' } }),
      3,
      'confirm-key',
    );
    expect(() => controller.preview({ debug: '1' }, {}, 'key', request))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
