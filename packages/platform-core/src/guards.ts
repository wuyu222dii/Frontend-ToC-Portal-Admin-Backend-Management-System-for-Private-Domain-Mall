import { ApplicationError } from './errors';
import { isValidUlid } from './identifiers';

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || (point >= 0x7f && point <= 0x9f));
  });
}

export function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

export function requirePage(page: number, pageSize: number, pageSizeMax = 100): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > pageSizeMax) {
    throw new TypeError(`Page size must be between 1 and ${pageSizeMax}`);
  }
  if (!Number.isSafeInteger((page - 1) * pageSize)) {
    throw new TypeError('Page offset is outside the supported range');
  }
}

export function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}
