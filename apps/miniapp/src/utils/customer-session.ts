import type { CustomerSession } from '../types/store-identity';

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type CustomerSessionPlatform = 'h5' | 'mp-weixin';
export const CUSTOMER_SESSION_STORAGE_KEY = 'qingxu:customer-refresh:v1';
const CUSTOMER_SESSION_STORAGE_VERSION = 1;

export interface CustomerRefreshCredential {
  readonly refresh_token: string;
  readonly refresh_expires_at: string;
}

interface StoredCustomerRefresh extends CustomerRefreshCredential {
  readonly schema_version: 1;
}

let memorySession: CustomerSession | null = null;
let sessionRevision = 0;
let sessionGeneration = 0;

function runtimePlatform(): CustomerSessionPlatform {
  return process.env.UNI_PLATFORM === 'mp-weixin' ? 'mp-weixin' : 'h5';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 512;
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function parseStoredCustomerRefresh(value: unknown): CustomerRefreshCredential | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schema_version',
    'refresh_token',
    'refresh_expires_at',
  ]) || value.schema_version !== CUSTOMER_SESSION_STORAGE_VERSION ||
    !isToken(value.refresh_token) || !isDateTime(value.refresh_expires_at)) {
    return null;
  }
  return {
    refresh_token: value.refresh_token,
    refresh_expires_at: value.refresh_expires_at,
  };
}

export function loadCustomerSession(now = Date.now()): CustomerSession | null {
  if (memorySession !== null && Date.parse(memorySession.refresh_expires_at) <= now) {
    clearCustomerSession();
  }
  return memorySession;
}

export function loadCustomerRefreshCredential(
  platform: CustomerSessionPlatform = runtimePlatform(),
  now = Date.now(),
): CustomerRefreshCredential | null {
  const currentSession = loadCustomerSession(now);
  if (currentSession !== null) {
    return {
      refresh_token: currentSession.refresh_token,
      refresh_expires_at: currentSession.refresh_expires_at,
    };
  }
  if (platform === 'h5') return null;
  try {
    const stored = uni.getStorageSync(CUSTOMER_SESSION_STORAGE_KEY) as unknown;
    const credential = parseStoredCustomerRefresh(stored);
    if (credential !== null && Date.parse(credential.refresh_expires_at) <= now) {
      uni.removeStorageSync(CUSTOMER_SESSION_STORAGE_KEY);
      return null;
    }
    if (credential === null && stored !== '' && stored !== undefined && stored !== null) {
      uni.removeStorageSync(CUSTOMER_SESSION_STORAGE_KEY);
    }
    return credential;
  } catch {
    return null;
  }
}

export function saveCustomerSession(
  session: CustomerSession,
  platform: CustomerSessionPlatform = runtimePlatform(),
): void {
  memorySession = session;
  sessionRevision += 1;
  sessionGeneration += 1;
  persistCustomerSession(session, platform);
}

export function acceptRotatedCustomerSession(
  session: CustomerSession,
  platform: CustomerSessionPlatform = runtimePlatform(),
): void {
  memorySession = session;
  sessionRevision += 1;
  persistCustomerSession(session, platform);
}

function persistCustomerSession(
  session: CustomerSession,
  platform: CustomerSessionPlatform,
): void {
  if (platform === 'h5') {
    try {
      uni.removeStorageSync(CUSTOMER_SESSION_STORAGE_KEY);
    } catch {
      // The H5 session remains memory-only even if legacy cleanup fails.
    }
    return;
  }
  const stored: StoredCustomerRefresh = {
    schema_version: CUSTOMER_SESSION_STORAGE_VERSION,
    refresh_token: session.refresh_token,
    refresh_expires_at: session.refresh_expires_at,
  };
  uni.setStorageSync(CUSTOMER_SESSION_STORAGE_KEY, stored);
}

export function clearCustomerSession(): void {
  memorySession = null;
  sessionRevision += 1;
  sessionGeneration += 1;
  try {
    uni.removeStorageSync(CUSTOMER_SESSION_STORAGE_KEY);
  } catch {
    // Callers still treat the in-memory session as signed out.
  }
}

export function customerSessionRevision(): number {
  return sessionRevision;
}

export function customerSessionGeneration(): number {
  return sessionGeneration;
}

export function hasRefreshableCustomerSession(now = Date.now()): boolean {
  const credential = loadCustomerRefreshCredential();
  return credential !== null && Date.parse(credential.refresh_expires_at) > now;
}
