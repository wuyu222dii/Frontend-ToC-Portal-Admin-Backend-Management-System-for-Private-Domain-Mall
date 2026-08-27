import { generateOpaqueToken, hmacAuthenticationSecret } from './authentication-secrets';

export interface StoreAttributionHashKey {
  key: Uint8Array;
}

export interface StoreAttributionHashKeyRing {
  current: StoreAttributionHashKey;
  previous: readonly StoreAttributionHashKey[];
}

function requireBoundedSecret(value: string, label: string, minimum: number, maximum: number): void {
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || length < minimum || length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
}

export function generateStoreCandidateToken(): string {
  return generateOpaqueToken('cnd');
}

export function hmacStoreCandidateToken(value: string, key: Uint8Array): string {
  requireBoundedSecret(value, 'Store candidate token', 32, 512);
  return hmacAuthenticationSecret(value, key, 'candidate-token');
}

export function storeCandidateTokenHashCandidates(
  value: string,
  keys: StoreAttributionHashKeyRing,
): readonly string[] {
  const candidates = [keys.current, ...keys.previous].map(({ key }) => hmacStoreCandidateToken(value, key));
  return [...new Set(candidates)];
}

export function hmacStoreInviteCode(value: string, key: Uint8Array): string {
  requireBoundedSecret(value, 'Store invite code', 1, 128);
  return hmacAuthenticationSecret(value, key, 'invite-code');
}
