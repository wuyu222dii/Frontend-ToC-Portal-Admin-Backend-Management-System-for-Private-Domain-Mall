import {
  createEncryptionContext,
  decryptEnvelopeText,
  type EncryptedEnvelope,
  hmacAuthenticationSecret,
} from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  createAgentContactPhoneMaterial,
  createAgentInviteCodeMaterial,
  generateAgentInviteCode,
  generateAgentTemporaryPassword,
} from './agent-security';

const AGENT_ID = '01J00000000000000000000001';
const INVITE_ID = '01J00000000000000000000002';
const FIELD_KEY = { id: 'field-v1', key: Buffer.alloc(32, 0x31) };
const HASH_KEY = { id: 'auth-v1', key: Buffer.alloc(32, 0x42) };

function decrypt(ciphertext: Buffer, table: string, id: string, field: string): string {
  const envelope = JSON.parse(ciphertext.toString('utf8')) as EncryptedEnvelope;
  return decryptEnvelopeText(
    envelope,
    (keyId) => {
      if (keyId !== FIELD_KEY.id) throw new TypeError('Unexpected key ID');
      return FIELD_KEY.key;
    },
    createEncryptionContext(table, id, field),
  );
}

describe('Agent security material', () => {
  it('generates bounded strong temporary passwords and high-entropy invite codes', () => {
    const password = generateAgentTemporaryPassword();
    const invite = generateAgentInviteCode();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password.length).toBeLessThanOrEqual(128);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
    expect(invite).toMatch(/^AGT-[A-Za-z0-9_-]{16}$/);
  });

  it('encrypts contact phone with record-bound AAD and stores only its tail', () => {
    const material = createAgentContactPhoneMaterial(AGENT_ID, '13900001234', FIELD_KEY);
    expect(material.last4).toBe('1234');
    expect(material.encryptionKeyId).toBe(FIELD_KEY.id);
    expect(decrypt(material.ciphertext, 'agent_profile', AGENT_ID, 'contact_phone_ciphertext'))
      .toBe('13900001234');
    expect(material.ciphertext.toString('utf8')).not.toContain('13900001234');
  });

  it('separates encrypted invite disclosure from lookup HMAC', () => {
    const code = generateAgentInviteCode();
    const material = createAgentInviteCodeMaterial(INVITE_ID, code, FIELD_KEY, HASH_KEY);
    expect(material.last4).toBe(code.slice(-4));
    expect(material.codeHash).toBe(hmacAuthenticationSecret(code, HASH_KEY.key, 'invite-code'));
    expect(decrypt(material.ciphertext, 'agent_invite_code', INVITE_ID, 'code_ciphertext')).toBe(code);
    expect(material.ciphertext.toString('utf8')).not.toContain(code);
  });
});
