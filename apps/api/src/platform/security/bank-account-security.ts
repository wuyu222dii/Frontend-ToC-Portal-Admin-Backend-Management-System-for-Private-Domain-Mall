import { createHmac } from 'node:crypto';

import type { SecurityKeyConfig, SecurityKeyRingConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  decryptEnvelopeText,
  encryptEnvelope,
  isValidUlid,
  type EncryptedEnvelope,
} from '@qingxu/platform-core';

const ACCOUNT_NUMBER = /^[0-9]{6,32}$/;
const ENVELOPE_FIELDS = new Set(['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version']);
const HMAC_DOMAIN = 'qingxu:agent-bank-account-number:v1\0';

export interface AgentBankAccountMaterial {
  accountHash: string;
  ciphertext: Buffer;
  encryptionKeyId: string;
  last4: string;
}

export interface StoredAgentBankAccountMaterial {
  bankAccountId: string;
  ciphertext: Buffer;
  encryptionKeyId: string;
  last4: string;
}

function parseEnvelope(ciphertext: Buffer): EncryptedEnvelope {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.byteLength < 1 || ciphertext.byteLength > 4_096) {
    throw new TypeError('Bank account ciphertext is invalid');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(ciphertext.toString('utf8')); } catch {
    throw new TypeError('Bank account ciphertext is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype ||
    Object.keys(parsed).length !== ENVELOPE_FIELDS.size ||
    Object.keys(parsed).some((field) => !ENVELOPE_FIELDS.has(field))) {
    throw new TypeError('Bank account ciphertext is invalid');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' ||
    typeof envelope.authTag !== 'string' || typeof envelope.ciphertext !== 'string' ||
    typeof envelope.iv !== 'string' || typeof envelope.keyId !== 'string') {
    throw new TypeError('Bank account ciphertext is invalid');
  }
  return envelope as unknown as EncryptedEnvelope;
}

export function normalizeAgentBankAccountNumber(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Bank account number must be a string');
  const normalized = value.replaceAll(' ', '').replaceAll('-', '');
  if (!ACCOUNT_NUMBER.test(normalized)) {
    throw new TypeError('Bank account number must contain 6 to 32 ASCII digits');
  }
  return normalized;
}

export function maskAgentBankAccountHolder(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('Bank account holder is invalid');
  const characters = Array.from(value);
  return `${characters[0]}${'*'.repeat(Math.max(1, characters.length - 1))}`;
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

export function decryptAgentBankAccountNumber(
  material: StoredAgentBankAccountMaterial,
  fieldKeys: SecurityKeyRingConfig,
): string {
  if (!isValidUlid(material.bankAccountId) || !/^[0-9]{4}$/.test(material.last4)) {
    throw new TypeError('Stored bank account metadata is invalid');
  }
  const envelope = parseEnvelope(material.ciphertext);
  if (envelope.keyId !== material.encryptionKeyId) {
    throw new TypeError('Stored bank account encryption key is inconsistent');
  }
  const key = [fieldKeys.current, ...fieldKeys.previous].find((candidate) => candidate.id === envelope.keyId);
  if (!key) throw new TypeError('Stored bank account encryption key is unavailable');
  let plaintext: string;
  try {
    plaintext = decryptEnvelopeText(
      envelope,
      () => key.key,
      createEncryptionContext('agent_bank_account', material.bankAccountId, 'account_no_ciphertext'),
    );
  } catch {
    throw new TypeError('Stored bank account ciphertext could not be authenticated');
  }
  const accountNumber = normalizeAgentBankAccountNumber(plaintext);
  if (accountNumber !== plaintext || accountNumber.slice(-4) !== material.last4) {
    throw new TypeError('Stored bank account plaintext metadata is inconsistent');
  }
  return accountNumber;
}
