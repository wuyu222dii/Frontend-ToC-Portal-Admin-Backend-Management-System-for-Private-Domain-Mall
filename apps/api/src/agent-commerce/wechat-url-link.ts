import { Injectable } from '@nestjs/common';
import type { WechatMiniappEnvVersion } from '@qingxu/config';
import { ApplicationError } from '@qingxu/platform-core';

export interface WechatUrlLinkRequest {
  appId: string;
  appSecret: string;
  envVersion: WechatMiniappEnvVersion;
  path: string;
  query: string;
}

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const URL_LINK_URL = 'https://api.weixin.qq.com/wxa/generate_urllink';
const PROVIDER_TIMEOUT_MS = 5_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const MAX_URL_LENGTH = 500;

function unavailable(): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', 'Promotion mini program link is unavailable');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_URL_LENGTH) throw unavailable();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unavailable();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw unavailable();
  return url.toString();
}

@Injectable()
export class WechatUrlLinkClient {
  private tokenCache: { appId: string; expiresAt: number; token: string } | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async generate(input: WechatUrlLinkRequest): Promise<string> {
    const token = await this.accessToken(input.appId, input.appSecret);
    const response = await this.readJson(URL_LINK_URL, {
      body: JSON.stringify({
        env_version: input.envVersion,
        expire_interval: 365,
        expire_type: 1,
        path: input.path,
        query: input.query,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      query: { access_token: token },
    });
    if (response.errcode !== undefined && response.errcode !== 0) throw unavailable();
    return parseHttpsUrl(response.url_link);
  }

  private async accessToken(appId: string, appSecret: string): Promise<string> {
    const cached = this.tokenCache;
    if (cached !== null && cached.appId === appId && cached.expiresAt > Date.now()) return cached.token;
    const response = await this.readJson(TOKEN_URL, {
      method: 'GET',
      query: { appid: appId, grant_type: 'client_credential', secret: appSecret },
    });
    if (typeof response.access_token !== 'string' || response.access_token.length < 1) throw unavailable();
    const expiresIn = typeof response.expires_in === 'number' && Number.isFinite(response.expires_in)
      ? response.expires_in
      : 0;
    if (expiresIn < 1) throw unavailable();
    this.tokenCache = {
      appId,
      expiresAt: Date.now() + expiresIn * 1_000 - TOKEN_EXPIRY_SKEW_MS,
      token: response.access_token,
    };
    return response.access_token;
  }

  private async readJson(
    baseUrl: string,
    init: {
      body?: string;
      headers?: Record<string, string>;
      method: 'GET' | 'POST';
      query: Record<string, string>;
    },
  ): Promise<Record<string, unknown>> {
    const url = new URL(baseUrl);
    for (const [name, value] of Object.entries(init.query)) url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...(init.body === undefined ? {} : { body: init.body }),
        ...(init.headers === undefined ? {} : { headers: init.headers }),
        method: init.method,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw unavailable();
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw unavailable();
    }
    if (!response.ok || !isRecord(payload)) throw unavailable();
    return payload;
  }
}
