import { timingSafeEqual } from 'node:crypto';

import { generate, generateSecret, generateURI } from 'otplib';

export interface TotpVerification {
  timestep: bigint;
  valid: boolean;
}

const TOTP_PERIOD_SECONDS = 30;

export function createTotpSecret(): string {
  return generateSecret();
}

export function createTotpUri(secret: string, label: string, issuer = 'Qingxu Commerce'): string {
  if (!label || label.length > 80) throw new TypeError('TOTP labels must contain 1 to 80 characters');
  return generateURI({ issuer, label, secret });
}

function tokenMatches(actual: string, candidate: string): boolean {
  if (!/^[0-9]{6}$/.test(actual) || !/^[0-9]{6}$/.test(candidate)) return false;
  return timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(candidate, 'ascii'));
}

export async function verifyTotpCode(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<TotpVerification> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !/^[0-9]{6}$/.test(token)) {
    return { timestep: -1n, valid: false };
  }
  const currentStep = Math.floor(now.getTime() / 1_000 / TOTP_PERIOD_SECONDS);
  for (const step of [currentStep, currentStep - 1, currentStep + 1]) {
    const candidate = await generate({ secret, epoch: step * TOTP_PERIOD_SECONDS });
    if (tokenMatches(token, candidate)) return { timestep: BigInt(step), valid: true };
  }
  return { timestep: -1n, valid: false };
}
