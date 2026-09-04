import { createHmac } from 'node:crypto';

import type { SecurityKeyConfig, SecurityKeyRingConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  encryptEnvelope,
  isValidUlid,
} from '@qingxu/platform-core';

const ACCOUNT_NUMBER = /^[0-9]{6,32}$/;
const HMAC_DOMAIN = 'qingxu:agent-bank-account-number:v1\0';

export interface AgentBankAccountMaterial {
  accountHash: string;
  ciphertext: Buffer;
  encryptionKeyId: string;
  last4: string;
}

export function normalizeAgentBankAccountNumber(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Bank account number must be a string');
  const normalized = value.replaceAll(' ', '').replaceAll('-', '');
  if (!ACCOUNT_NUMBER.test(normalized)) {
    throw new TypeError('Bank account number must contain 6 to 32 ASCII digits');
  }
  return normalized;
}

export function hmacAgentBankAccountNumber(value: string, key: Uint8Array): string {
  const normalized = normalizeAgentBankAccountNumber(value);
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new TypeError('Bank account HMAC keys must contain exactly 32 bytes');
  }
  return createHmac('sha256', Buffer.from(key))
    .update(HMAC_DOMAIN, 'utf8')
    .update(normalized, 'utf8')
    .digest('hex');
}

export function createAgentBankAccountMaterial(
  bankAccountId: string,
  accountNumber: string,
  currentFieldKey: SecurityKeyConfig,
  currentHashKey: SecurityKeyConfig,
): AgentBankAccountMaterial {
  if (!isValidUlid(bankAccountId)) throw new TypeError('Bank account ID must be a ULID');
  const normalized = normalizeAgentBankAccountNumber(accountNumber);
  const envelope = encryptEnvelope(
    normalized,
    { key: currentFieldKey.key, keyId: currentFieldKey.id },
    createEncryptionContext('agent_bank_account', bankAccountId, 'account_no_ciphertext'),
  );
  return {
    accountHash: hmacAgentBankAccountNumber(normalized, currentHashKey.key),
    ciphertext: Buffer.from(JSON.stringify(envelope), 'utf8'),
    encryptionKeyId: currentFieldKey.id,
    last4: normalized.slice(-4),
  };
}

export function agentBankAccountHashCandidates(
  value: string,
  keys: SecurityKeyRingConfig,
): readonly string[] {
  if (typeof keys !== 'object' || keys === null || !keys.current || !Array.isArray(keys.previous)) {
    throw new TypeError('Bank account HMAC key ring is invalid');
  }
  return [...new Set(
    [keys.current, ...keys.previous].map(({ key }) => hmacAgentBankAccountNumber(value, key)),
  )];
}
