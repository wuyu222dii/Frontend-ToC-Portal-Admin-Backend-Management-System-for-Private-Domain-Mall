import { describe, expect, it } from 'vitest';

import { createAccessLogEntry } from './access-log.middleware';

describe('createAccessLogEntry', () => {
  it('constructs a fixed allowlisted record without request payloads or headers', () => {
    const request = {
      body: { password: 'should-not-be-logged' },
      headers: { authorization: 'Bearer should-not-be-logged' },
      method: 'POST',
      principal: {
        accountId: 'account_1',
        assurance: 'MFA' as const,
        permissions: ['ORDER_FULFILLMENT_PII_READ'],
        restriction: 'NONE' as const,
        role: 'SUPER_ADMIN' as const,
        sessionId: 'session_1',
      },
      requestId: 'request_1',
      resultCode: 'OK',
      route: { path: '/platform-probe/success' },
    };

    const entry = createAccessLogEntry(request, { statusCode: 200 }, 1.6);

    expect(entry).toEqual({
      account_id: 'account_1',
      actor_role: 'SUPER_ADMIN',
      duration_ms: 2,
      method: 'POST',
      request_id: 'request_1',
      result_code: 'OK',
      route: '/platform-probe/success',
      service: 'api',
      session_id: 'session_1',
      status_code: 200,
    });
    expect(JSON.stringify(entry)).not.toContain('should-not-be-logged');
  });

  it('does not log a raw URL when no route template matched', () => {
    expect(
      createAccessLogEntry(
        { method: 'GET', requestId: 'request_2', resultCode: 'RESOURCE_NOT_FOUND' },
        { statusCode: 404 },
        -1,
      ),
    ).toEqual({
      duration_ms: 0,
      method: 'GET',
      request_id: 'request_2',
      result_code: 'RESOURCE_NOT_FOUND',
      route: 'UNMATCHED',
      service: 'api',
      status_code: 404,
    });
  });

  it('omits raw account and session identifiers for customer principals', () => {
    const entry = createAccessLogEntry({
      method: 'GET',
      principal: {
        accountId: 'customer_account_1',
        assurance: 'WECHAT',
        permissions: [],
        restriction: 'NONE',
        role: 'CUSTOMER',
        sessionId: 'customer_session_1',
      },
      requestId: 'request_3',
      resultCode: 'OK',
      route: { path: '/store/orders' },
    }, { statusCode: 200 }, 1);

    expect(entry).toEqual({
      actor_role: 'CUSTOMER',
      duration_ms: 1,
      method: 'GET',
      request_id: 'request_3',
      result_code: 'OK',
      route: '/store/orders',
      service: 'api',
      status_code: 200,
    });
    expect(JSON.stringify(entry)).not.toContain('customer_account_1');
    expect(JSON.stringify(entry)).not.toContain('customer_session_1');
  });
});
