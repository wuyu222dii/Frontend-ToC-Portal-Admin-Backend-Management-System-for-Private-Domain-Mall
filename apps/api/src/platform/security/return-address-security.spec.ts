import { describe, expect, it } from 'vitest';

import {
  createReturnAddressSnapshotSecurityMaterial,
  createReturnAddressVersionSecurityMaterial,
  normalizeReturnAddressPhone,
  verifyReturnAddressSnapshotSecurityMaterial,
  verifyReturnAddressVersionSecurityMaterial,
} from './return-address-security';

const VERSION_ID = '01J00000000000000000000001';
const SNAPSHOT_ID = '01J00000000000000000000002';
const CURRENT = { id: 'return-address-field-v2', key: Buffer.alloc(32, 0x22) };
const PREVIOUS = { id: 'return-address-field-v1', key: Buffer.alloc(32, 0x11) };
const PHONE = '+1 2-3';
const DETAIL = 'Development return desk, level 2';

describe('B12 return-address AES-GCM security boundary', () => {
  it('preserves the last four literal phone characters and verifies a current version key', () => {
    const material = createReturnAddressVersionSecurityMaterial({
      detail: `  ${DETAIL}  `,
      phone: `  ${PHONE}  `,
      versionId: VERSION_ID,
    }, CURRENT);

    expect(material.phoneLast4).toBe(PHONE.slice(-4));
    expect(verifyReturnAddressVersionSecurityMaterial(material, {
      current: CURRENT,
      previous: [PREVIOUS],
    })).toMatchObject({
      detail: DETAIL,
      phone: PHONE,
      phoneMasked: `*** ${PHONE.slice(-4)}`,
      requiresFieldKeyUpgrade: false,
    });
  });

  it('accepts a rotated previous key and keeps version and snapshot AAD domains distinct', () => {
    const version = createReturnAddressVersionSecurityMaterial({
      detail: DETAIL,
      phone: PHONE,
      versionId: VERSION_ID,
    }, PREVIOUS);
    expect(verifyReturnAddressVersionSecurityMaterial(version, {
      current: CURRENT,
      previous: [PREVIOUS],
    }).requiresFieldKeyUpgrade).toBe(true);

    const snapshot = createReturnAddressSnapshotSecurityMaterial({
      detail: DETAIL,
      phone: PHONE,
      snapshotId: SNAPSHOT_ID,
    }, CURRENT);
    expect(verifyReturnAddressSnapshotSecurityMaterial(snapshot, {
      current: CURRENT,
      previous: [],
    })).toMatchObject({ detail: DETAIL, phone: PHONE });
    expect(() => verifyReturnAddressVersionSecurityMaterial(snapshot, {
      current: CURRENT,
      previous: [],
    })).toThrow();
  });

  it('fails closed for metadata tampering, unknown keys, and contract-invalid phones', () => {
    const material = createReturnAddressSnapshotSecurityMaterial({
      detail: DETAIL,
      phone: PHONE,
      snapshotId: SNAPSHOT_ID,
    }, CURRENT);
    expect(() => verifyReturnAddressSnapshotSecurityMaterial({
      ...material,
      phoneLast4: '0000',
    }, { current: CURRENT, previous: [] })).toThrow();
    expect(() => verifyReturnAddressSnapshotSecurityMaterial(material, {
      current: PREVIOUS,
      previous: [],
    })).toThrow();
    for (const invalid of ['12345', '1234567890123456789012345678901', '12345A', '123\n456']) {
      expect(() => normalizeReturnAddressPhone(invalid)).toThrow();
    }
  });
});
