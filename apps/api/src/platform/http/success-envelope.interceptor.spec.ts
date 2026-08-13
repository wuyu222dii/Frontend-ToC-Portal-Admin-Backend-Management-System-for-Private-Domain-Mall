import { of, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { preEnvelopedResponse, SuccessEnvelopeInterceptor } from './success-envelope.interceptor';

describe('SuccessEnvelopeInterceptor pre-enveloped command replay', () => {
  it('unwraps only the branded internal marker and preserves the original request ID', async () => {
    const request = { originalUrl: '/api/v1/admin/auth/logout', requestId: 'req_new' };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    } as never;
    const envelope = { code: 'OK' as const, data: { status: 'REVOKED' }, message: 'success' as const, request_id: 'req_original' };
    const value = await lastValueFrom(new SuccessEnvelopeInterceptor().intercept(context, {
      handle: () => of(preEnvelopedResponse(envelope)),
    }));
    expect(value).toEqual(envelope);
  });

  it('does not trust an unbranded envelope-shaped controller value', async () => {
    const request = { originalUrl: '/api/v1/probe', requestId: 'req_new' };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    } as never;
    const data = { code: 'OK', data: {}, message: 'success', request_id: 'forged' };
    const value = await lastValueFrom(new SuccessEnvelopeInterceptor().intercept(context, { handle: () => of(data) }));
    expect(value).toEqual({ code: 'OK', data, message: 'success', request_id: 'req_new' });
  });
});
