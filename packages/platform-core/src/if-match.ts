import { ApplicationError } from './errors';

export const IF_MATCH_PATTERN = /^"[1-9][0-9]*"$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function parseIfMatch(value: string | undefined): number {
  if (value === undefined || !IF_MATCH_PATTERN.test(value)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'If-Match must contain a quoted positive version', [
      {
        field: 'If-Match',
        reason: 'Expected a strong ETag such as "12"',
        rejected_value: value ?? null,
      },
    ]);
  }

  const version = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(version) || version > POSTGRES_INTEGER_MAX) {
    throw new ApplicationError('INVALID_ARGUMENT', 'If-Match version is outside the supported range', [
      {
        field: 'If-Match',
        reason: 'Version must fit a positive PostgreSQL INTEGER',
        rejected_value: value,
      },
    ]);
  }

  return version;
}

export function formatVersionEtag(version: number): string {
  if (!Number.isInteger(version) || version < 1 || version > POSTGRES_INTEGER_MAX) {
    throw new TypeError('Resource version must be a positive PostgreSQL INTEGER');
  }

  return `"${version}"`;
}

export function assertIfMatch(value: string | undefined, currentVersion: number): number {
  const expectedVersion = parseIfMatch(value);
  if (expectedVersion !== currentVersion) {
    throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'The resource version has changed');
  }

  return expectedVersion;
}
