import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerSession } from '../types/store-identity';
import {
  clearCustomerSession,
  CUSTOMER_SESSION_STORAGE_KEY,
  hasRefreshableCustomerSession,
  loadCustomerRefreshCredential,
  loadCustomerSession,
  parseStoredCustomerRefresh,
  saveCustomerSession,
} from './customer-session';

const session: CustomerSession = {
  access_token: 'a'.repeat(20),
  refresh_token: 'r'.repeat(20),
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2030-01-01T00:00:00.000Z',
  refresh_expires_at: '2030-02-01T00:00:00.000Z',
};

describe('minimal CUSTOMER session storage', () => {
  afterEach(() => {
    clearCustomerSession();
    vi.unstubAllGlobals();
  });

  function storageEnvironment() {
    const values = new Map<string, unknown>();
    const removeStorageSync = vi.fn((key: string) => values.delete(key));
    vi.stubGlobal('uni', {
      getStorageSync: (key: string) => values.get(key),
      removeStorageSync,
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
    });
    return { removeStorageSync, values };
  }

  it('accepts only the exact versioned refresh credential shape', () => {
    expect(parseStoredCustomerRefresh({
      schema_version: 1,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    })).toEqual({
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    });
    expect(parseStoredCustomerRefresh({
      schema_version: 2,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    })).toBeNull();
    expect(parseStoredCustomerRefresh({
      schema_version: 1,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    })).toBeNull();
  });

  it('keeps H5 credentials in memory and removes any legacy browser storage', () => {
    const current = storageEnvironment();
    current.values.set(CUSTOMER_SESSION_STORAGE_KEY, { legacy: true });
    saveCustomerSession(session, 'h5');
    expect(loadCustomerSession()).toEqual(session);
    expect(loadCustomerRefreshCredential('h5')).toEqual({
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    });
    expect(current.values.size).toBe(0);
    expect(current.removeStorageSync).toHaveBeenCalledWith(CUSTOMER_SESSION_STORAGE_KEY);
  });

  it('persists only refresh material for MP-Weixin cold-start rotation', () => {
    const current = storageEnvironment();
    saveCustomerSession(session, 'mp-weixin');
    expect(current.values.get(CUSTOMER_SESSION_STORAGE_KEY)).toEqual({
      schema_version: 1,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
    });
    expect(current.values.get(CUSTOMER_SESSION_STORAGE_KEY)).not.toHaveProperty('access_token');
    expect(hasRefreshableCustomerSession(Date.parse('2029-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('clears expired memory and MP refresh credentials before credential selection', () => {
    const current = storageEnvironment();
    const expired = {
      ...session,
      access_expires_at: '2025-01-01T00:00:00.000Z',
      refresh_expires_at: '2025-01-02T00:00:00.000Z',
    };
    saveCustomerSession(expired, 'h5');
    expect(loadCustomerSession(Date.parse('2025-01-03T00:00:00.000Z'))).toBeNull();

    current.values.set(CUSTOMER_SESSION_STORAGE_KEY, {
      schema_version: 1,
      refresh_token: expired.refresh_token,
      refresh_expires_at: expired.refresh_expires_at,
    });
    expect(loadCustomerRefreshCredential(
      'mp-weixin',
      Date.parse('2025-01-03T00:00:00.000Z'),
    )).toBeNull();
    expect(current.values.has(CUSTOMER_SESSION_STORAGE_KEY)).toBe(false);
  });
});
