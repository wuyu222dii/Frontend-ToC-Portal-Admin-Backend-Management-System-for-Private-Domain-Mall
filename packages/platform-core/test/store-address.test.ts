import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createStoreAddressSecurityMaterial,
  generateUlid,
  hmacStoreAddressPhone,
  maskStoreAddressDetail,
  maskStoreAddressPhone,
  maskStoreAddressRecipient,
  normalizeStoreAddressPhone,
  verifyStoreAddressSecurityMaterial,
} from '../src';

describe('Store address security primitives', () => {
  const addressId = generateUlid();
  const fieldKey = { id: 'address-field-v1', key: Buffer.alloc(32, 11) };
  const phoneHashKey = { id: 'address-phone-v1', key: Buffer.alloc(32, 12) };

  it('accepts only an 11-digit ASCII phone and produces non-revealing masks', () => {
    expect(normalizeStoreAddressPhone('13800006821')).toBe('13800006821');
    expect(maskStoreAddressPhone('13800006821')).toBe('138 **** 6821');
    expect(maskStoreAddressRecipient('张三')).toBe('张*');
    expect(maskStoreAddressRecipient('李')).toBe('李*');
    expect(maskStoreAddressRecipient('Harry')).toBe('H****');
    expect(maskStoreAddressDetail('浙江省杭州市某路 18 号')).toBe('浙江省杭 ****');
    for (const value of ['+8613800006821', '138 0000 6821', '１３８００００６８２１', '1380000682']) {
      expect(() => normalizeStoreAddressPhone(value)).toThrow(TypeError);
    }
  });

  it('uses an address-specific keyed HMAC domain', () => {
    const digest = hmacStoreAddressPhone('13800006821', phoneHashKey.key);
    const bare = createHmac('sha256', phoneHashKey.key).update('13800006821').digest('hex');
    const accountDomain = createHmac('sha256', phoneHashKey.key)
      .update('qingxu:store-account-phone:v1\0')
      .update('13800006821')
      .digest('hex');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toBe(bare);
    expect(digest).not.toBe(accountDomain);
  });

  it('encrypts both fields with address-and-column AAD and verifies retained key rings', () => {
    const material = createStoreAddressSecurityMaterial({
      addressId,
      detail: ' 18 Example Road ',
      phone: '13800006821',
    }, fieldKey, phoneHashKey);
    const verified = verifyStoreAddressSecurityMaterial(material, {
      current: { id: 'address-field-v2', key: Buffer.alloc(32, 13) },
      previous: [fieldKey],
    }, {
      current: { id: 'address-phone-v2', key: Buffer.alloc(32, 14) },
      previous: [phoneHashKey],
    });
    expect(verified).toEqual({
      currentPhoneHash: hmacStoreAddressPhone('13800006821', Buffer.alloc(32, 14)),
      detail: '18 Example Road',
      detailMasked: '18 ****',
      phone: '13800006821',
      phoneMasked: '138 **** 6821',
      requiresFieldKeyUpgrade: true,
      requiresPhoneHashUpgrade: true,
    });
    expect(Buffer.from(material.phoneCiphertext).toString('utf8')).not.toContain('13800006821');
    expect(Buffer.from(material.detailCiphertext).toString('utf8')).not.toContain('Example Road');
  });

  it('fails closed after either retained field or phone-HMAC key is removed', () => {
    const material = createStoreAddressSecurityMaterial({
      addressId,
      detail: '18 Example Road',
      phone: '13800006821',
    }, fieldKey, phoneHashKey);
    const nextField = { id: 'address-field-v2', key: Buffer.alloc(32, 13) };
    const nextHash = { id: 'address-phone-v2', key: Buffer.alloc(32, 14) };
    expect(() => verifyStoreAddressSecurityMaterial(material, {
      current: nextField,
      previous: [],
    }, {
      current: nextHash,
      previous: [phoneHashKey],
    })).toThrow('unavailable');
    expect(() => verifyStoreAddressSecurityMaterial(material, {
      current: nextField,
      previous: [fieldKey],
    }, {
      current: nextHash,
      previous: [],
    })).toThrow('HMAC is invalid');
  });

  it('enforces recipient and detail Unicode length and control-character boundaries', () => {
    expect(maskStoreAddressRecipient('A'.repeat(80))).toBe(`A${'*'.repeat(79)}`);
    expect(maskStoreAddressDetail('A'.repeat(300))).toBe('AAAA ****');
    for (const recipient of ['A'.repeat(81), 'Alice\nSmith', 'Alice\u0085Smith', '\tAlice', '  ']) {
      expect(() => maskStoreAddressRecipient(recipient)).toThrow(TypeError);
    }
    for (const detail of ['A'.repeat(301), 'Road\u0000Unit', 'Road\n', '  ']) {
      expect(() => maskStoreAddressDetail(detail)).toThrow(TypeError);
    }
  });

  it('fails closed for cross-field, cross-address, hash, tail and envelope tampering', () => {
    const material = createStoreAddressSecurityMaterial({
      addressId,
      detail: '18 Example Road',
      phone: '13800006821',
    }, fieldKey, phoneHashKey);
    const rings = { current: fieldKey, previous: [] };
    const hashRings = { current: phoneHashKey, previous: [] };
    const phoneEnvelope = JSON.parse(Buffer.from(material.phoneCiphertext).toString('utf8')) as {
      authTag: string;
    };
    const tamperedAuthTag = {
      ...phoneEnvelope,
      authTag: `${phoneEnvelope.authTag.startsWith('A') ? 'B' : 'A'}${phoneEnvelope.authTag.slice(1)}`,
    };
    const cases = [
      { ...material, addressId: generateUlid() },
      { ...material, phoneCiphertext: material.detailCiphertext },
      { ...material, phoneCiphertext: Buffer.from(JSON.stringify(tamperedAuthTag)) },
      { ...material, phoneHash: '0'.repeat(64) },
      { ...material, phoneLast4: '0000' },
      { ...material, encryptionKeyId: 'address-field-v2' },
      { ...material, detailCiphertext: Buffer.from('{}') },
    ];
    for (const value of cases) {
      expect(() => verifyStoreAddressSecurityMaterial(value, rings, hashRings)).toThrow();
    }
  });
});
