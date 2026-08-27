import { describe, expect, it } from 'vitest';

import {
  generateStoreCandidateToken,
  hmacStoreCandidateToken,
  hmacStoreInviteCode,
  storeCandidateTokenHashCandidates,
} from '../src';

describe('B7.3 Store attribution cryptographic primitives', () => {
  it('generates opaque high-entropy candidate tokens and hashes only with the candidate domain', () => {
    const key = Buffer.alloc(32, 17);
    const first = generateStoreCandidateToken();
    const second = generateStoreCandidateToken();

    expect(first).toMatch(/^cnd_[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hmacStoreCandidateToken(first, key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hmacStoreCandidateToken(first, key)).not.toBe(hmacStoreInviteCode(first, key));
    expect(hmacStoreInviteCode('A', key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hmacStoreInviteCode(' A ', key)).not.toBe(hmacStoreInviteCode('A', key));
  });

  it('returns deduplicated current-then-previous token hash candidates', () => {
    const token = generateStoreCandidateToken();
    const current = Buffer.alloc(32, 1);
    const previous = Buffer.alloc(32, 2);

    expect(storeCandidateTokenHashCandidates(token, {
      current: { key: current },
      previous: [{ key: previous }, { key: current }],
    })).toEqual([
      hmacStoreCandidateToken(token, current),
      hmacStoreCandidateToken(token, previous),
    ]);
  });

  it.each([
    ['', 'invite'],
    ['x'.repeat(129), 'invite'],
    ['short', 'candidate'],
    ['c'.repeat(513), 'candidate'],
  ])('rejects invalid %s material for the %s domain', (value, domain) => {
    const key = Buffer.alloc(32, 3);
    const operation = domain === 'invite'
      ? () => hmacStoreInviteCode(value, key)
      : () => hmacStoreCandidateToken(value, key);
    expect(operation).toThrow();
  });
});
