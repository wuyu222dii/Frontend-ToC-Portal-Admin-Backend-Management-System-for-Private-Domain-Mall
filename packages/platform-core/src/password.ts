import { hash, verify, argon2id } from 'argon2';

const PASSWORD_MIN_LENGTH = 12;

export function assertAdminPassword(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new TypeError('Administrator passwords must contain at least 12 characters');
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertAdminPassword(password);
  return hash(password, {
    type: argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
}

export async function verifyPasswordHash(passwordHash: string, password: string): Promise<boolean> {
  if (typeof passwordHash !== 'string' || !passwordHash.startsWith('$argon2id$') ||
    typeof password !== 'string') {
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
