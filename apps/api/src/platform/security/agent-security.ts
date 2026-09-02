import { randomBytes } from 'node:crypto';

import type { SecurityKeyConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  encryptEnvelope,
  hmacAuthenticationSecret,
  isValidUlid,
} from '@qingxu/platform-core';

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
