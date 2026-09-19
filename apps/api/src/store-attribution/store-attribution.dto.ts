import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface StoreAttributionCandidateInput {
  inviteCode: string;
  promotionAssetId?: string;
}

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function objectWithAllowedFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const body = value as PlainRecord;
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !(field in body)) || Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function boundedSecret(value: unknown, field: string, minimum: number, maximum: number): string {
  const characters = typeof value === 'string' ? Array.from(value) : [];
  if (typeof value !== 'string' || characters.length < minimum || characters.length > maximum) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

export function parseStoreAttributionCandidateBody(value: unknown): StoreAttributionCandidateInput {
  const body = objectWithAllowedFields(value, ['invite_code'], ['promotion_asset_id']);
  const parsed: StoreAttributionCandidateInput = {
    inviteCode: boundedSecret(body.invite_code, 'invite_code', 1, 128),
  };
  if (!('promotion_asset_id' in body)) return parsed;
  const promotionAssetId = body.promotion_asset_id;
  if (typeof promotionAssetId !== 'string' || !isValidUlid(promotionAssetId)) {
    return invalid('promotion_asset_id is invalid');
  }
  parsed.promotionAssetId = promotionAssetId;
  return parsed;
}
