import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import {
  parseStoreCheckoutQuoteBody,
  type StoreCheckoutQuoteRequest,
} from '../store-checkout/store-checkout.dto';

const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;

export interface StoreOrderSubmitRequest extends StoreCheckoutQuoteRequest {
  confirmationHash: string;
  quoteId: string;
  quoteToken: string;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function exactObject(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const record = value as PlainRecord;
  const fields = [
    'source',
    'address_id',
    'items',
    'quote_id',
    'quote_token',
    'confirmation_hash',
  ] as const;
  const expected = new Set<string>(fields);
  if (fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field)) ||
    Object.keys(record).some((field) => !expected.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return record;
}

export function parseStoreOrderSubmitBody(value: unknown): StoreOrderSubmitRequest {
  const body = exactObject(value);
  const quote = parseStoreCheckoutQuoteBody({
    address_id: body.address_id,
    items: body.items,
    source: body.source,
  });
  if (typeof body.quote_id !== 'string' || !isValidUlid(body.quote_id)) {
    return invalid('quote_id is invalid');
  }
  const quoteTokenLength = typeof body.quote_token === 'string'
    ? Array.from(body.quote_token).length
    : 0;
  if (typeof body.quote_token !== 'string' || quoteTokenLength < 32 || quoteTokenLength > 512) {
    return invalid('quote_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return {
    ...quote,
    confirmationHash: body.confirmation_hash,
    quoteId: body.quote_id,
    quoteToken: body.quote_token,
  };
}
