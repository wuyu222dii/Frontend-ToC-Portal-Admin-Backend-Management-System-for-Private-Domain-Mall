import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { SecurityKeyConfig, SecurityKeyRingConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  decryptEnvelopeText,
  encryptEnvelope,
  hmacAuthenticationSecret,
  type EncryptedEnvelope,
  isValidUlid,
} from '@qingxu/platform-core';

const ENVELOPE_FIELDS = new Set(['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version']);
const INVITE_CODE = /^AGT-[A-Za-z0-9_-]{16}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const MAX_CIPHERTEXT_BYTES = 4_096;
const MAX_PREVIOUS_KEYS = 3;

export interface AgentContactPhoneMaterial {
  ciphertext: Buffer;
  encryptionKeyId: string;
  last4: string;
}

export interface AgentInviteCodeMaterial {
  ciphertext: Buffer;
  codeHash: string;
  encryptionKeyId: string;
  last4: string;
}

function serializeEnvelope(value: ReturnType<typeof encryptEnvelope>): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function parseEnvelope(ciphertext: Buffer): EncryptedEnvelope {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.byteLength < 1 ||
    ciphertext.byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new TypeError('Agent invite-code ciphertext is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(ciphertext.toString('utf8'));
  } catch {
    throw new TypeError('Agent invite-code ciphertext is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype ||
    Object.keys(parsed).length !== ENVELOPE_FIELDS.size ||
    Object.keys(parsed).some((field) => !ENVELOPE_FIELDS.has(field))) {
    throw new TypeError('Agent invite-code ciphertext is invalid');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' ||
    typeof envelope.authTag !== 'string' || typeof envelope.ciphertext !== 'string' ||
    typeof envelope.iv !== 'string' || typeof envelope.keyId !== 'string') {
    throw new TypeError('Agent invite-code ciphertext is invalid');
  }
  return envelope as unknown as EncryptedEnvelope;
}

function activeFieldKeys(fieldKeys: SecurityKeyRingConfig): readonly SecurityKeyConfig[] {
  if (typeof fieldKeys !== 'object' || fieldKeys === null || !fieldKeys.current ||
    !Array.isArray(fieldKeys.previous) || fieldKeys.previous.length > MAX_PREVIOUS_KEYS) {
    throw new TypeError('Agent invite-code field key ring is invalid');
  }
  const keys = [fieldKeys.current, ...fieldKeys.previous];
  if (keys.some(({ id, key }) => !KEY_ID.test(id) || !Buffer.isBuffer(key) || key.byteLength !== 32) ||
    new Set(keys.map(({ id }) => id)).size !== keys.length ||
    keys.some((key, index) => keys.some((candidate, candidateIndex) =>
      index !== candidateIndex && timingSafeEqual(key.key, candidate.key)))) {
    throw new TypeError('Agent invite-code field key ring is invalid');
  }
  return keys;
}

export function generateAgentTemporaryPassword(): string {
  return `Tmp!9${randomBytes(18).toString('base64url')}`;
}

export function generateAgentInviteCode(): string {
  return `AGT-${randomBytes(12).toString('base64url')}`;
}

export function createAgentContactPhoneMaterial(
  agentId: string,
  phone: string,
  fieldKey: SecurityKeyConfig,
): AgentContactPhoneMaterial {
  if (!isValidUlid(agentId) || !/^[0-9]{11}$/.test(phone)) {
    throw new TypeError('Agent contact phone security input is invalid');
  }
  const envelope = encryptEnvelope(
    phone,
    { key: fieldKey.key, keyId: fieldKey.id },
    createEncryptionContext('agent_profile', agentId, 'contact_phone_ciphertext'),
  );
  return {
    ciphertext: serializeEnvelope(envelope),
    encryptionKeyId: fieldKey.id,
    last4: phone.slice(-4),
  };
}

export function createAgentInviteCodeMaterial(
  inviteCodeId: string,
  code: string,
  fieldKey: SecurityKeyConfig,
  secretHashKey: SecurityKeyConfig,
): AgentInviteCodeMaterial {
  if (!isValidUlid(inviteCodeId) || typeof code !== 'string' || code.length < 16 || code.length > 128) {
    throw new TypeError('Agent invite-code security input is invalid');
  }
  const envelope = encryptEnvelope(
    code,
    { key: fieldKey.key, keyId: fieldKey.id },
    createEncryptionContext('agent_invite_code', inviteCodeId, 'code_ciphertext'),
  );
  return {
    ciphertext: serializeEnvelope(envelope),
    codeHash: hmacAuthenticationSecret(code, secretHashKey.key, 'invite-code'),
    encryptionKeyId: fieldKey.id,
    last4: code.slice(-4),
  };
}

export function decryptAgentInviteCode(
  inviteCodeId: string,
  ciphertext: Buffer,
  encryptionKeyId: string,
  fieldKeys: SecurityKeyRingConfig,
): string {
  if (!isValidUlid(inviteCodeId)) throw new TypeError('Agent invite-code ID is invalid');
  const envelope = parseEnvelope(ciphertext);
  if (!KEY_ID.test(encryptionKeyId) || envelope.keyId !== encryptionKeyId) {
    throw new TypeError('Agent invite-code encryption key ID is invalid');
  }
  const keys = activeFieldKeys(fieldKeys);
  const matchingKey = keys.find(({ id }) => id === envelope.keyId);
  if (!matchingKey) throw new TypeError('Agent invite-code field key is unavailable');
  let code: string;
  try {
    code = decryptEnvelopeText(
      envelope,
      () => matchingKey.key,
      createEncryptionContext('agent_invite_code', inviteCodeId, 'code_ciphertext'),
    );
  } catch {
    throw new TypeError('Agent invite-code ciphertext could not be authenticated');
  }
  if (!INVITE_CODE.test(code)) throw new TypeError('Agent invite-code plaintext is invalid');
  return code;
}
