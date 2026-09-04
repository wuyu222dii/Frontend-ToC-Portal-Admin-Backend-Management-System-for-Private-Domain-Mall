import { createHmac } from 'node:crypto';

import {
  createEncryptionContext,
  decryptEnvelopeText,
  type EncryptedEnvelope,
} from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  agentBankAccountHashCandidates,
  createAgentBankAccountMaterial,
  decryptAgentBankAccountNumber,
  hmacAgentBankAccountNumber,
  maskAgentBankAccountHolder,
  normalizeAgentBankAccountNumber,
} from './bank-account-security';

const BANK_ACCOUNT_ID = '01J00000000000000000000001';
const OTHER_BANK_ACCOUNT_ID = '01J00000000000000000000002';
const FIELD_KEY = { id: 'field-v2', key: Buffer.alloc(32, 0x31) };
const HASH_CURRENT = { id: 'bank-hash-v2', key: Buffer.alloc(32, 0x42) };
const HASH_PREVIOUS = { id: 'bank-hash-v1', key: Buffer.alloc(32, 0x43) };
const FORMATTED_ACCOUNT_NUMBER = '1234-5678 9012-3456';
const ACCOUNT_NUMBER = '1234567890123456';

describe('B13 Agent bank-account security boundary', () => {
  it('uses one deterministic holder mask without exposing trailing characters', () => {
    expect(maskAgentBankAccountHolder('Alice Example')).toBe('A************');
    expect(maskAgentBankAccountHolder('李雷')).toBe('李*');
    expect(() => maskAgentBankAccountHolder('')).toThrow();
  });

  it('removes only ASCII spaces and hyphens before validating 6 to 32 digits', () => {
    expect(normalizeAgentBankAccountNumber(FORMATTED_ACCOUNT_NUMBER)).toBe(ACCOUNT_NUMBER);
    for (const invalid of [
      '12345',
      '123456789012345678901234567890123',
      '12345A',
      '123\t456',
      '123\u2010456',
    ]) {
      expect(() => normalizeAgentBankAccountNumber(invalid)).toThrow();
    }
  });

  it('encrypts the normalized number with record-bound AAD and stores only safe metadata', () => {
    const material = createAgentBankAccountMaterial(
      BANK_ACCOUNT_ID,
      FORMATTED_ACCOUNT_NUMBER,
      FIELD_KEY,
      HASH_CURRENT,
    );
    const envelope = JSON.parse(material.ciphertext.toString('utf8')) as EncryptedEnvelope;

    expect(material).toMatchObject({
      accountHash: hmacAgentBankAccountNumber(ACCOUNT_NUMBER, HASH_CURRENT.key),
      encryptionKeyId: FIELD_KEY.id,
      last4: '3456',
    });
    expect(material.ciphertext.toString('utf8')).not.toContain(ACCOUNT_NUMBER);
    expect(decryptEnvelopeText(
      envelope,
      () => FIELD_KEY.key,
      createEncryptionContext('agent_bank_account', BANK_ACCOUNT_ID, 'account_no_ciphertext'),
    )).toBe(ACCOUNT_NUMBER);
    expect(() => decryptEnvelopeText(
      envelope,
      () => FIELD_KEY.key,
      createEncryptionContext('agent_bank_account', OTHER_BANK_ACCOUNT_ID, 'account_no_ciphertext'),
    )).toThrow();
  });

  it('uses a bank-account-specific HMAC domain across current and previous keys', () => {
    const current = hmacAgentBankAccountNumber(FORMATTED_ACCOUNT_NUMBER, HASH_CURRENT.key);
    const expected = createHmac('sha256', HASH_CURRENT.key)
      .update('qingxu:agent-bank-account-number:v1\0', 'utf8')
      .update(ACCOUNT_NUMBER, 'utf8')
      .digest('hex');

    expect(current).toBe(expected);
    expect(agentBankAccountHashCandidates(FORMATTED_ACCOUNT_NUMBER, {
      current: HASH_CURRENT,
      previous: [HASH_PREVIOUS],
    })).toEqual([
      current,
      hmacAgentBankAccountNumber(ACCOUNT_NUMBER, HASH_PREVIOUS.key),
    ]);
    expect(() => hmacAgentBankAccountNumber(ACCOUNT_NUMBER, Buffer.alloc(31))).toThrow();
  });

  it('decrypts only an authenticated record-bound snapshot with consistent metadata', () => {
    const material = createAgentBankAccountMaterial(
      BANK_ACCOUNT_ID,
      FORMATTED_ACCOUNT_NUMBER,
      FIELD_KEY,
      HASH_CURRENT,
    );
    const stored = {
      bankAccountId: BANK_ACCOUNT_ID,
      ciphertext: material.ciphertext,
      encryptionKeyId: material.encryptionKeyId,
      last4: material.last4,
    };
    expect(decryptAgentBankAccountNumber(stored, { current: FIELD_KEY, previous: [] }))
      .toBe(ACCOUNT_NUMBER);
    expect(() => decryptAgentBankAccountNumber({ ...stored, bankAccountId: OTHER_BANK_ACCOUNT_ID }, {
      current: FIELD_KEY,
      previous: [],
    })).toThrow();
    expect(() => decryptAgentBankAccountNumber({ ...stored, last4: '9999' }, {
      current: FIELD_KEY,
      previous: [],
    })).toThrow();
    expect(() => decryptAgentBankAccountNumber(stored, {
      current: { id: 'field-v3', key: Buffer.alloc(32, 0x33) },
      previous: [],
    })).toThrow();
  });
});
