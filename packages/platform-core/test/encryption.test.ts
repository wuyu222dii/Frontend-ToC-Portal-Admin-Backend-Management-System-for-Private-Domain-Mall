import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  decryptEnvelopeText,
  encryptEnvelope,
  createEncryptionContext,
  generateUlid,
  hmacSha256IpAddress,
  type EncryptedEnvelope,
} from '../src';

const encryptionKey = randomBytes(32);
const hmacKey = randomBytes(32);
const firstContext = createEncryptionContext('mfa_factor', generateUlid(), 'secret_ciphertext');
const secondContext = createEncryptionContext('mfa_factor', generateUlid(), 'secret_ciphertext');

describe('AES-256-GCM envelope encryption', () => {
  it('round trips plaintext using the envelope key ID', () => {
    const envelope = encryptEnvelope(
      'sensitive-value',
      { keyId: 'development-key-v1', key: encryptionKey },
      firstContext,
    );

    expect(envelope).toMatchObject({
      version: 1,
      algorithm: 'AES-256-GCM',
      keyId: 'development-key-v1',
    });
    expect(envelope.ciphertext).not.toContain('sensitive-value');
    expect(
      decryptEnvelopeText(
        envelope,
        (keyId) => {
          expect(keyId).toBe('development-key-v1');
          return encryptionKey;
        },
        firstContext,
      ),
    ).toBe('sensitive-value');
  });

  it('uses a fresh nonce for repeated plaintext', () => {
    const first = encryptEnvelope('same', { keyId: 'key-v1', key: encryptionKey }, firstContext);
    const second = encryptEnvelope('same', { keyId: 'key-v1', key: encryptionKey }, firstContext);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects tampered key identity, context, ciphertext, and invalid key sizes', () => {
    const envelope = encryptEnvelope('value', { keyId: 'key-v1', key: encryptionKey }, firstContext);
    const replacement = envelope.ciphertext.startsWith('A') ? 'B' : 'A';
    const tampered: EncryptedEnvelope = {
      ...envelope,
      ciphertext: `${replacement}${envelope.ciphertext.slice(1)}`,
    };

    expect(() => decryptEnvelopeText(envelope, () => encryptionKey, secondContext)).toThrow();
    expect(() => decryptEnvelopeText({ ...envelope, keyId: 'key-v2' }, () => encryptionKey, firstContext)).toThrow();
    expect(() => decryptEnvelopeText(tampered, () => encryptionKey, firstContext)).toThrow();
    expect(() => encryptEnvelope('value', { keyId: 'key-v1', key: randomBytes(31) }, firstContext))
      .toThrow(TypeError);
  });

  it('requires a record-and-field-bound context', () => {
    expect(() => createEncryptionContext('mfa_factor', 'not-an-ulid', 'secret_ciphertext'))
      .toThrow('table:ULID:field');
    expect(() => createEncryptionContext('mfa:factor', generateUlid(), 'secret_ciphertext'))
      .toThrow('table:ULID:field');
  });
});

describe('IP address HMAC', () => {
  it('is deterministic, irreversible in the stored value, and normalizes harmless casing', () => {
    const first = hmacSha256IpAddress(' 2001:DB8::1 ', hmacKey);
    const second = hmacSha256IpAddress('2001:db8::1', hmacKey);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('2001');
  });

  it('requires a non-empty address and a strong independent HMAC key', () => {
    expect(() => hmacSha256IpAddress('', hmacKey)).toThrow(TypeError);
    expect(() => hmacSha256IpAddress('not-an-ip', hmacKey)).toThrow(TypeError);
    expect(() => hmacSha256IpAddress('127.0.0.1', 'short-key')).toThrow(TypeError);
  });
});
