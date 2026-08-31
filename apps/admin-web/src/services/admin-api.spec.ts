import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminApiRequest } from './admin-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Admin API exact success status', () => {
  it('fails closed when shipment creation returns 200 instead of the required 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'OK',
      data: {},
      message: 'success',
      request_id: 'req_unexpected_success_status',
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })));

    const request = adminApiRequest('/admin/orders/01ARZ3NDEKTSV4RRFFQ69G5FAV/shipments', {
      expectedStatus: 201,
      method: 'POST',
    });

    await expect(request).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });
});
