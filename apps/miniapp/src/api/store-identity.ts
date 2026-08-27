import type { components } from '@qingxu/contracts';

import type {
  AttributionCandidate,
  AttributionCandidateCreate,
  AttributionCandidateInput,
  CustomerProfile,
  CustomerSession,
  DeletionConfirmInput,
  DeletionPreview,
  DeletionResult,
  LegalDocuments,
  PhoneAuthorizationInput,
  ProfileUpdateInput,
  ServiceAgent,
  WechatAuthData,
  WechatLoginInput,
} from '../types/store-identity';
import {
  clearCustomerSession,
  customerSessionRevision,
  loadCustomerRefreshCredential,
  loadCustomerSession,
  saveCustomerSession,
  type CustomerRefreshCredential,
} from '../utils/customer-session';
import {
  clearCandidateToken,
  peekCandidateToken,
  setCandidateToken,
} from '../utils/attribution-candidate';
import {
  StoreApiError,
  StoreEnvelopeFormatError,
  storeApiRequest,
  type StoreRequestOptions,
} from './store-client';
import {
  decodeAttributionCandidateCreate,
  decodeCandidateRejectData,
  decodeCommandData,
  decodeCustomerProfile,
  decodeCustomerSession,
  decodeDeletionPreview,
  decodeDeletionResult,
  decodeLegalDocuments,
  decodeNullableAttributionCandidate,
  decodeNullableServiceAgent,
  decodeServiceAgent,
  decodeWechatAuthData,
} from './store-identity-decoders';

type CommandData = components['schemas']['CommandResponse']['data'];
type CandidateRejectData = components['schemas']['AttributionCandidateRejectResponse']['data'];

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

export function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoValue = globalThis.crypto;
  if (cryptoValue?.getRandomValues) {
    cryptoValue.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = randomByte();
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bearerHeader(accessToken: string): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${accessToken}` };
}

function ifMatch(version: number): string {
  return `"${version}"`;
}

export function getLegalDocuments(): Promise<LegalDocuments> {
  return storeApiRequest('/store/legal-documents', { decode: decodeLegalDocuments }).promise;
}

export function loginWithWechat(
  input: WechatLoginInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<WechatAuthData> {
  const candidateToken = input.candidate_token ?? peekCandidateToken();
  const body: WechatLoginInput = candidateToken === null
    ? input
    : { ...input, candidate_token: candidateToken };
  return storeApiRequest('/store/auth/wechat/login', {
    data: body,
    decode: decodeWechatAuthData,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  }).promise.then((result) => {
    saveCustomerSession(result.session);
    if (candidateToken !== null) clearCandidateToken();
    return result;
  });
}

let refreshInFlight: Promise<CustomerSession> | null = null;

function refreshCustomerSession(session: CustomerRefreshCredential): Promise<CustomerSession> {
  const startingRevision = customerSessionRevision();
  refreshInFlight ??= storeApiRequest('/store/auth/refresh', {
    data: { refresh_token: session.refresh_token },
    decode: decodeCustomerSession,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  }).promise.then((next) => {
    if (customerSessionRevision() !== startingRevision) {
      const latest = loadCustomerSession();
      if (latest !== null) return latest;
      throw new StoreApiError('会话已经变化', { status: 401, code: 'SESSION_EXPIRED' });
    }
    saveCustomerSession(next);
    return next;
  }).catch((error: unknown) => {
    if (customerSessionRevision() !== startingRevision) {
      const latest = loadCustomerSession();
      if (latest !== null) return latest;
      throw error;
    }
    clearCustomerSession();
    throw error;
  }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function clearSessionIfCurrent(session: CustomerSession): void {
  if (loadCustomerSession()?.refresh_token === session.refresh_token) clearCustomerSession();
}

async function authenticatedRequest<T>(
  path: string,
  options: StoreRequestOptions<T> = {},
): Promise<T> {
  const session = loadCustomerSession() ?? await (async () => {
    const credential = loadCustomerRefreshCredential();
    if (credential === null || Date.parse(credential.refresh_expires_at) <= Date.now()) return null;
    return refreshCustomerSession(credential);
  })();
  if (session === null) {
    throw new StoreApiError('请先登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
  const request = (current: CustomerSession) => storeApiRequest<T>(path, {
    ...options,
    headers: { ...options.headers, ...bearerHeader(current.access_token) },
  }).promise;
  try {
    return await request(session);
  } catch (error) {
    if (!(error instanceof StoreApiError) || error.status !== 401) throw error;
    const latest = loadCustomerSession();
    if (latest !== null && latest.refresh_token !== session.refresh_token) {
      try {
        return await request(latest);
      } catch (retryError) {
        if (retryError instanceof StoreApiError && retryError.status === 401) {
          clearSessionIfCurrent(latest);
        }
        throw retryError;
      }
    }
    const refreshed = await refreshCustomerSession(session);
    try {
      return await request(refreshed);
    } catch (retryError) {
      if (retryError instanceof StoreApiError && retryError.status === 401) {
        clearSessionIfCurrent(refreshed);
      }
      throw retryError;
    }
  }
}

export async function logoutCustomer(): Promise<CommandData> {
  try {
    return await authenticatedRequest<CommandData>('/store/auth/logout', {
      decode: decodeCommandData,
      headers: { 'Idempotency-Key': createIdempotencyKey() },
      method: 'POST',
    });
  } finally {
    clearCustomerSession();
  }
}

export function getCustomerProfile(): Promise<CustomerProfile> {
  return authenticatedRequest('/store/profile', { decode: decodeCustomerProfile });
}

export function updateCustomerProfile(
  input: ProfileUpdateInput,
  version: number,
): Promise<CustomerProfile> {
  return authenticatedRequest('/store/profile', {
    data: input,
    decode: decodeCustomerProfile,
    headers: {
      'Idempotency-Key': createIdempotencyKey(),
      'If-Match': ifMatch(version),
    },
    method: 'PATCH',
  });
}

export function authorizeCustomerPhone(
  input: PhoneAuthorizationInput,
  version: number,
): Promise<CustomerProfile> {
  return authenticatedRequest('/store/profile/phone-authorizations', {
    data: input,
    decode: decodeCustomerProfile,
    headers: {
      'Idempotency-Key': createIdempotencyKey(),
      'If-Match': ifMatch(version),
    },
    method: 'POST',
  });
}

export function revokeCustomerPhone(version: number): Promise<CustomerProfile> {
  return authenticatedRequest('/store/profile/phone', {
    decode: decodeCustomerProfile,
    headers: {
      'Idempotency-Key': createIdempotencyKey(),
      'If-Match': ifMatch(version),
    },
    method: 'DELETE',
  });
}

export function getAttributionCandidate(): Promise<AttributionCandidate | null> {
  const session = loadCustomerSession();
  if (session !== null || loadCustomerRefreshCredential() !== null) {
    return authenticatedRequest('/store/attribution/candidate', {
      decode: decodeNullableAttributionCandidate,
    });
  }
  const token = peekCandidateToken();
  if (token === null) {
    return Promise.reject(new StoreApiError('没有待确认的服务关系', {
      status: 401,
      code: 'AUTH_REQUIRED',
    }));
  }
  return storeApiRequest('/store/attribution/candidate', {
    decode: decodeNullableAttributionCandidate,
    headers: { 'X-Candidate-Token': token },
  }).promise;
}

export function createAttributionCandidate(
  input: AttributionCandidateInput,
): Promise<AttributionCandidateCreate> {
  const requestOptions: StoreRequestOptions<AttributionCandidateCreate> = {
    data: input,
    decode: decodeAttributionCandidateCreate,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  };
  const session = loadCustomerSession();
  const authenticated = session !== null || loadCustomerRefreshCredential() !== null;
  const request = authenticated
    ? authenticatedRequest('/store/attribution/candidates', requestOptions)
    : storeApiRequest('/store/attribution/candidates', {
      ...requestOptions,
      headers: {
        ...requestOptions.headers,
        ...(peekCandidateToken() === null
          ? {}
          : { 'X-Candidate-Token': peekCandidateToken() as string }),
      },
    }).promise;
  return request.then((result) => {
    if ((authenticated && result.candidate_token !== null) ||
      (!authenticated && result.candidate !== null && result.candidate_token === null)) {
      throw new StoreEnvelopeFormatError();
    }
    if (result.candidate_token !== null) setCandidateToken(result.candidate_token);
    return result;
  });
}

export function confirmAttributionCandidate(): Promise<ServiceAgent> {
  return authenticatedRequest('/store/attribution/candidate/confirm', {
    decode: decodeServiceAgent,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  });
}

export function rejectAttributionCandidate(): Promise<CandidateRejectData> {
  return authenticatedRequest('/store/attribution/candidate/reject', {
    decode: decodeCandidateRejectData,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  });
}

export function getServiceAgent(): Promise<ServiceAgent | null> {
  return authenticatedRequest('/store/service-agent', { decode: decodeNullableServiceAgent });
}

export function previewAccountDeletion(): Promise<DeletionPreview> {
  return authenticatedRequest('/store/privacy/deletion-requests/preview', {
    data: { acknowledged: true },
    decode: decodeDeletionPreview,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  });
}

export function confirmAccountDeletion(
  input: DeletionConfirmInput,
  accountVersion: number,
): Promise<DeletionResult> {
  return authenticatedRequest('/store/privacy/deletion-requests', {
    data: input,
    decode: decodeDeletionResult,
    headers: {
      'Idempotency-Key': createIdempotencyKey(),
      'If-Match': ifMatch(accountVersion),
    },
    method: 'POST',
  }).then((result) => {
    clearCustomerSession();
    clearCandidateToken();
    return result;
  });
}
