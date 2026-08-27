import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createEncryptionContext,
  encryptEnvelope,
  generateUlid,
  hmacStoreAccountPhone,
  maskStoreAccountPhone,
  normalizeStoreAccountPhone,
  verifyStoredStorePhoneMaterial,
} from '../src';

describe('Store account phone primitives', () => {
  const key = Buffer.alloc(32, 7);

  it('normalizes only the frozen 11-digit provider output and creates its public mask', () => {
    expect(normalizeStoreAccountPhone('13800006821')).toBe('13800006821');
    expect(maskStoreAccountPhone('13800006821')).toBe('138 **** 6821');
    for (const value of ['+8613800006821', '138 0000 6821', '１３８００００６８２１', '1380000682']) {
      expect(() => normalizeStoreAccountPhone(value)).toThrow(TypeError);
    }
  });

  it('uses a keyed purpose-separated digest rather than a bare phone hash', () => {
    const digest = hmacStoreAccountPhone('13800006821', key);
    const bare = createHmac('sha256', key).update('13800006821').digest('hex');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toBe(bare);
    expect(digest).not.toBe(hmacStoreAccountPhone('13900006821', key));
    expect(digest).not.toBe(hmacStoreAccountPhone('13800006821', Buffer.alloc(32, 8)));
  });

  it('rejects a non-32-byte HMAC key', () => {
    expect(() => hmacStoreAccountPhone('13800006821', Buffer.alloc(31))).toThrow(TypeError);
  });

  it('verifies retained field/HMAC keys and derives the current HMAC without returning plaintext', () => {
    const id = generateUlid();
    const previousField = { id: 'field-v1', key: Buffer.alloc(32, 10) };
    const currentField = { id: 'field-v2', key: Buffer.alloc(32, 11) };
    const previousHash = { id: 'phone-v1', key: Buffer.alloc(32, 12) };
    const currentHash = { id: 'phone-v2', key: Buffer.alloc(32, 13) };
    const envelope = encryptEnvelope('13800006821', {
      keyId: previousField.id,
      key: previousField.key,
    },
      createEncryptionContext('customer_phone_verification', id, 'phone_ciphertext'));
    const verified = verifyStoredStorePhoneMaterial({
      encryptionKeyId: previousField.id,
      id,
      phoneCiphertext: Buffer.from(JSON.stringify(envelope)),
      phoneHash: hmacStoreAccountPhone('13800006821', previousHash.key),
      phoneLast4: '6821',
    }, {
      current: currentField,
      previous: [previousField],
    }, {
      current: currentHash,
      previous: [previousHash],
    });
    expect(verified).toEqual({
      currentPhoneHash: hmacStoreAccountPhone('13800006821', currentHash.key),
      masked: '138 **** 6821',
      requiresHashUpgrade: true,
    });
    expect(JSON.stringify(verified)).not.toContain('13800006821');
    expect(() => verifyStoredStorePhoneMaterial({
      encryptionKeyId: previousField.id,
      id,
      phoneCiphertext: Buffer.from(JSON.stringify(envelope)),
      phoneHash: hmacStoreAccountPhone('13800006821', previousHash.key),
      phoneLast4: '6821',
    }, {
      current: currentField,
      previous: [previousField],
    }, {
      current: currentHash,
      previous: [],
    })).toThrow('HMAC is invalid');
  });
});
