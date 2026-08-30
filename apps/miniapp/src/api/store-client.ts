import type { StoreErrorDetail, StoreErrorResponse } from '../types/store-catalog';

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type StoreApiPlatform = 'h5' | 'mp-weixin';

export interface StoreCancelableRequest<T> {
  readonly promise: Promise<T>;
  abort(): void;
}

export class StoreApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreApiConfigurationError';
  }
}

export class StoreEnvelopeFormatError extends Error {
  constructor() {
    super('Store API response envelope is invalid');
    this.name = 'StoreEnvelopeFormatError';
  }
}

export class StoreApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly details: readonly StoreErrorDetail[];
  readonly aborted: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      requestId?: string | null;
      retryAfterSeconds?: number | null;
      details?: readonly StoreErrorDetail[];
      aborted?: boolean;
    },
  ) {
    super(message);
    this.name = 'StoreApiError';
    this.status = options.status;
    this.code = options.code ?? 'NETWORK_ERROR';
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.details = options.details ?? [];
    this.aborted = options.aborted ?? false;
  }
}

type PlainRecord = Record<string, unknown>;
export type StoreQueryValue = boolean | number | string | undefined;
export type StoreSuccessStatus = 200 | 201 | 202;

export interface StoreRequestOptions<T = unknown> {
  readonly data?: unknown;
  readonly decode?: (value: unknown) => T;
  readonly expectedStatus?: StoreSuccessStatus | readonly StoreSuccessStatus[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  readonly query?: Readonly<Record<string, StoreQueryValue>>;
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: PlainRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    actualKeys.every((key) => allowedKeys.has(key));
}

function decodedPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new StoreEnvelopeFormatError();
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isErrorDetail(value: unknown): value is StoreErrorDetail {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['field', 'reason'], ['rejected_value'])) {
    return false;
  }
  const validField = value.field === null || typeof value.field === 'string';
  const validRejectedValue = value.rejected_value === undefined ||
    value.rejected_value === null || typeof value.rejected_value === 'string';
  return validField && nonEmptyString(value.reason) && validRejectedValue;
}

export function parseStoreSuccessEnvelope<T>(payload: unknown): T {
  const decoded = decodedPayload(payload);
  if (!isPlainRecord(decoded) ||
    !hasExactKeys(decoded, ['code', 'message', 'data', 'request_id']) ||
    decoded.code !== 'OK' || decoded.message !== 'success' ||
    !nonEmptyString(decoded.request_id)) {
    throw new StoreEnvelopeFormatError();
  }
  return decoded.data as T;
}

export function parseStoreErrorEnvelope(payload: unknown): StoreErrorResponse {
  const decoded = decodedPayload(payload);
  if (!isPlainRecord(decoded) ||
    !hasExactKeys(decoded, ['code', 'message', 'request_id'], ['details']) ||
    !nonEmptyString(decoded.code) || !nonEmptyString(decoded.message) ||
    !nonEmptyString(decoded.request_id) ||
    (decoded.details !== undefined &&
      (!Array.isArray(decoded.details) || !decoded.details.every(isErrorDetail)))) {
    throw new StoreEnvelopeFormatError();
  }
  return decoded as unknown as StoreErrorResponse;
}

function normalizedHeaderValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value) && value.length === 1) return normalizedHeaderValue(value[0]);
  return null;
}

export function parseRetryAfterSeconds(headers: unknown): number | null {
  if (!isPlainRecord(headers)) return null;
  const entry = Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'retry-after');
  const value = normalizedHeaderValue(entry?.[1]);
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function isLocalHostname(hostnameValue: string): boolean {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1') return true;
  if (hostname.includes(':') &&
    (/^(?:fc|fd)[0-9a-f:]+$/.test(hostname) || /^fe[89ab][0-9a-f:]+$/.test(hostname))) {
    return true;
  }

  const octetValues = hostname.split('.');
  if (octetValues.length !== 4 ||
    octetValues.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part))) {
    return false;
  }
  const octets = octetValues.map((part) => Number(part));
  if (octets.some((part) => part > 255)) return false;
  const first = octets[0];
  const second = octets[1];
  return first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function parseAbsoluteHttpBaseUrl(value: string): { hostname: string; protocol: 'http:' | 'https:' } {
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:\/[^\s?#]*)?$/i
    .exec(value);
  if (!match) {
    throw new StoreApiConfigurationError('VITE_MINIAPP_API_BASE_URL must be an absolute HTTP(S) URL');
  }

  const protocolValue = match[1];
  const hostname = match[2];
  const portValue = match[3];
  if (!protocolValue || !hostname) {
    throw new StoreApiConfigurationError('VITE_MINIAPP_API_BASE_URL is invalid');
  }
  if (portValue !== undefined) {
    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new StoreApiConfigurationError('VITE_MINIAPP_API_BASE_URL port is invalid');
    }
  }
  return {
    hostname,
    protocol: protocolValue.toLowerCase() === 'https' ? 'https:' : 'http:',
  };
}

export function resolveStoreApiBaseUrl(
  platform: StoreApiPlatform,
  configuredBaseUrl: string | undefined,
): string {
  if (platform === 'h5') return '/api/v1';

  const configured = configuredBaseUrl?.trim();
  if (!configured) return '/api/v1';

  const parsed = parseAbsoluteHttpBaseUrl(configured);
  if (parsed.protocol !== 'https:' && !isLocalHostname(parsed.hostname)) {
    throw new StoreApiConfigurationError('Non-local miniapp API URLs must use HTTPS');
  }
  return configured.replace(/\/+$/, '');
}

export function encodeStoreQuery(query: Readonly<Record<string, StoreQueryValue>>): string {
  const entries = Object.entries(query)
    .filter((entry): entry is [string, Exclude<StoreQueryValue, undefined>] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return entries.length > 0 ? `?${entries.join('&')}` : '';
}

function runtimePlatform(): StoreApiPlatform {
  return process.env.UNI_PLATFORM === 'mp-weixin' ? 'mp-weixin' : 'h5';
}

function requestUrl(path: string, query: Readonly<Record<string, StoreQueryValue>>): string {
  const baseUrl = resolveStoreApiBaseUrl(
    runtimePlatform(),
    import.meta.env.VITE_MINIAPP_API_BASE_URL,
  );
  return `${baseUrl}${path}${encodeStoreQuery(query)}`;
}

function invalidResponse(status: number, headers: unknown): StoreApiError {
  return new StoreApiError('服务响应格式不正确', {
    status: status >= 200 && status < 300 ? 502 : status,
    code: 'INVALID_RESPONSE',
    retryAfterSeconds: parseRetryAfterSeconds(headers),
  });
}

function httpError(status: number, payload: unknown, headers: unknown): StoreApiError {
  try {
    const envelope = parseStoreErrorEnvelope(payload);
    return new StoreApiError(envelope.message, {
      status,
      code: envelope.code,
      requestId: envelope.request_id,
      retryAfterSeconds: parseRetryAfterSeconds(headers),
      details: envelope.details ?? [],
    });
  } catch (error) {
    if (!(error instanceof StoreEnvelopeFormatError)) throw error;
    return invalidResponse(status, headers);
  }
}

export function storeApiRequest<T>(
  path: string,
  options: StoreRequestOptions<T> = {},
): StoreCancelableRequest<T> {
  let url: string;
  try {
    url = requestUrl(path, options.query ?? {});
  } catch (error) {
    return {
      promise: Promise.reject(error),
      abort() {},
    };
  }

  let task: UniNamespace.RequestTask | undefined;
  let settled = false;
  let abortRequested = false;
  const promise = new Promise<T>((resolve, reject) => {
    try {
      const method = options.method ?? 'GET';
      const expectedStatus = options.expectedStatus ?? 200;
      const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...options.headers,
      };
      if (options.data !== undefined) headers['Content-Type'] = 'application/json';
      const requestOptions: UniNamespace.RequestOptions = {
        url,
        method: method as NonNullable<UniNamespace.RequestOptions['method']>,
        ...(options.data === undefined
          ? {}
          : { data: options.data as NonNullable<UniNamespace.RequestOptions['data']> }),
        dataType: 'json',
        responseType: 'text',
        withCredentials: false,
        header: headers,
        success(response) {
          if (settled) return;
          settled = true;
          if (!expectedStatuses.includes(response.statusCode as StoreSuccessStatus)) {
            reject(httpError(response.statusCode, response.data, response.header));
            return;
          }
          try {
            const data = parseStoreSuccessEnvelope<unknown>(response.data);
            resolve(options.decode ? options.decode(data) : data as T);
          } catch (error) {
            reject(error instanceof StoreEnvelopeFormatError
              ? invalidResponse(response.statusCode, response.header)
              : error);
          }
        },
        fail(result) {
          if (settled) return;
          settled = true;
          const aborted = abortRequested || /abort/i.test(result.errMsg);
          reject(new StoreApiError(
            aborted ? '请求已取消' : '网络连接失败，请检查网络后重试',
            {
              status: 0,
              code: aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
              aborted,
            },
          ));
        },
      };
      task = uni.request(requestOptions) as unknown as UniNamespace.RequestTask;
    } catch {
      settled = true;
      reject(new StoreApiError('网络连接失败，请检查网络后重试', { status: 0 }));
    }
  });

  return {
    promise,
    abort() {
      if (settled) return;
      abortRequested = true;
      task?.abort();
    },
  };
}

export function storeApiGet<T>(
  path: string,
  query: Readonly<Record<string, StoreQueryValue>> = {},
): StoreCancelableRequest<T> {
  return storeApiRequest(path, { query });
}
