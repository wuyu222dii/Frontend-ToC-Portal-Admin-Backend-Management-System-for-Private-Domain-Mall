import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export {
  hasControlCharacter,
  internalError,
  requirePage,
  requireUlid,
} from '@qingxu/platform-core';

export function storedUlid(value: unknown, label: string): string {
  if (!isValidUlid(value)) {
    throw new ApplicationError('INTERNAL_ERROR', `${label} is invalid`);
  }
  return value;
}
