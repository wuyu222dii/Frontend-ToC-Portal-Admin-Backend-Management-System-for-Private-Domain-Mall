import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { AdminCommissionsController } from './admin-commissions.controller';
import type { AdminCommissionsService } from './admin-commissions.service';

const AGENT_ID = generateUlid();
const ORDER_ID = generateUlid();
const VERSION_ID = generateUlid();

const request = {
  accessSession: { sessionId: generateUlid() },
  principal: { accountId: generateUlid(), role: 'SUPER_ADMIN' },
  requestId: `req_${'1'.repeat(32)}`,
} as unknown as AdminCatalogRequestContext;

function harness() {
  const service = {
    getCurrentRules: vi.fn(),
    getOrderExplanation: vi.fn(),
    getRuleVersion: vi.fn(),
    listAgentCommissions: vi.fn(),
    listAgentWalletLedger: vi.fn(),
    listRuleSkus: vi.fn(),
    listRuleVersions: vi.fn(),
    previewRulePublish: vi.fn(),
    publishRuleVersion: vi.fn(),
  };
  return {
    controller: new AdminCommissionsController(service as unknown as AdminCommissionsService),
    service,
  };
}

describe('AdminCommissionsController', () => {
  it('requires SUPER_ADMIN and applies no-store to all nine operations', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminCommissionsController)).toEqual(['SUPER_ADMIN']);
    for (const handler of [
      AdminCommissionsController.prototype.getCurrentRules,
      AdminCommissionsController.prototype.listRuleSkus,
      AdminCommissionsController.prototype.previewRulePublish,
      AdminCommissionsController.prototype.publishRuleVersion,
      AdminCommissionsController.prototype.listRuleVersions,
      AdminCommissionsController.prototype.getRuleVersion,
      AdminCommissionsController.prototype.listAgentCommissions,
      AdminCommissionsController.prototype.listAgentWalletLedger,
      AdminCommissionsController.prototype.getOrderExplanation,
    ]) expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
  });

  it('strictly decodes first-publication confirmation before dispatch', () => {
    const { controller, service } = harness();
    controller.publishRuleVersion({}, {
      base_version_id: null,
      changes: [{ configured_rate: '0.0000', target_id: null, target_type: 'PLATFORM' }],
      confirmation_hash: 'a'.repeat(64),
      preview_token: 'pvw_0123456789abcdefghijklmnop',
      reason: 'Publish initial rules',
    }, '"0"', '00000000-0000-4000-8000-000000000001', request);

    expect(service.publishRuleVersion).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        baseVersionId: null,
        changes: [{ configuredRate: '0.0000', targetId: null, targetType: 'PLATFORM' }],
      }),
      0,
      '00000000-0000-4000-8000-000000000001',
    );
    expect(() => controller.publishRuleVersion({}, {}, '0', 'key', request))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('dispatches every read projection and rejects unknown query fields', () => {
    const { controller, service } = harness();
    controller.getCurrentRules({});
    controller.listRuleSkus({ page: '2', page_size: '10', source: 'SKU' });
    controller.listRuleVersions({ status: 'PUBLISHED' });
    controller.getRuleVersion(VERSION_ID, {});
    controller.listAgentCommissions(AGENT_ID, { position_state: 'EXPECTED' });
    controller.listAgentWalletLedger(AGENT_ID, { ledger_type: 'WITHDRAWAL_PAID' });
    controller.getOrderExplanation(ORDER_ID, {});

    expect(service.getCurrentRules).toHaveBeenCalledOnce();
    expect(service.listRuleSkus).toHaveBeenCalledWith({ page: 2, pageSize: 10, source: 'SKU' });
    expect(service.listRuleVersions).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: 'PUBLISHED' });
    expect(service.getRuleVersion).toHaveBeenCalledWith(VERSION_ID);
    expect(service.listAgentCommissions).toHaveBeenCalledWith(
      AGENT_ID,
      { page: 1, pageSize: 20, positionState: 'EXPECTED' },
    );
    expect(service.listAgentWalletLedger).toHaveBeenCalledWith(
      AGENT_ID,
      { ledgerType: 'WITHDRAWAL_PAID', page: 1, pageSize: 20 },
    );
    expect(service.getOrderExplanation).toHaveBeenCalledWith(ORDER_ID);
    expect(() => controller.getOrderExplanation(ORDER_ID, { debug: '1' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
