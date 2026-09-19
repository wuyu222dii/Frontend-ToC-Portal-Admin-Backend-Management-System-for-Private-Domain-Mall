import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { WechatUrlLinkClient } from './wechat-url-link';

const APP_ID = 'wx43d9ae5d376d7512';
const SECRET = 'development-secret-value';
const INVITE_CODE = 'AGT-abcdefghijklmnop';
const PROMOTION_ASSET_ID = '01HZXK3M4N5P6Q7R8S9T0V1W2Y';
const PRODUCT_ID = '01J7Z3K4M5N6P7Q8R9S0T1V2W3';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    json: async () => body,
    ok,
  } as Response;
}

describe('WechatUrlLinkClient', () => {
  it('requests a URL Link with path, query and env_version and caches the access token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, url_link: 'https://wxaurl.cn/demo' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, url_link: 'https://wxaurl.cn/demo-2' }));
    const client = new WechatUrlLinkClient(fetchImpl);
    const input = {
      appId: APP_ID,
      appSecret: SECRET,
      envVersion: 'trial' as const,
      path: 'pages/product/detail',
      query: `product_id=${PRODUCT_ID}&invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`,
    };

    await expect(client.generate(input)).resolves.toBe('https://wxaurl.cn/demo');
    await expect(client.generate(input)).resolves.toBe('https://wxaurl.cn/demo-2');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const tokenUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(tokenUrl).toContain('cgi-bin/token');
    expect(tokenUrl).toContain(`appid=${APP_ID}`);
    const linkInit = fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(linkInit.body))).toEqual({
      env_version: 'trial',
      expire_interval: 365,
      expire_type: 1,
      path: 'pages/product/detail',
      query: input.query,
    });
  });

  it('fails closed when WeChat returns an error payload', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));
    const client = new WechatUrlLinkClient(fetchImpl);
    await expect(client.generate({
      appId: APP_ID,
      appSecret: SECRET,
      envVersion: 'release',
      path: 'pages/index/index',
      query: `invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`,
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' } satisfies Partial<ApplicationError>);
  });
});
