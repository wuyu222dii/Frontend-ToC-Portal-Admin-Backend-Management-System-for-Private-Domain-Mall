import { ulid } from 'ulid';

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function generateUlid(timestamp?: number): string {
  return ulid(timestamp);
}

export function isValidUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}
