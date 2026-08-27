import { describe, expect, it } from 'vitest';

import {
  parseStoreDeletionConfirmBody,
  parseStoreDeletionPreviewBody,
} from './store-privacy.dto';

const TOKEN = `pvw_${'a'.repeat(43)}`;
const HASH = 'b'.repeat(64);

describe('B7.4 Store privacy DTO', () => {
  it('accepts only the frozen acknowledged preview body', () => {
    expect(parseStoreDeletionPreviewBody({ acknowledged: true })).toEqual({ acknowledged: true });
    for (const value of [
      {},
      { acknowledged: false },
      { acknowledged: true, reason: 'delete' },
      [],
      null,
    ]) {
      expect(() => parseStoreDeletionPreviewBody(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    }
  });

  it('accepts the exact confirm capability without normalizing secrets', () => {
    expect(parseStoreDeletionConfirmBody({
      acknowledged: true,
      confirmation_hash: HASH,
      preview_token: TOKEN,
    })).toEqual({ acknowledged: true, confirmationHash: HASH, previewToken: TOKEN });
  });

  it.each([
    [{ acknowledged: true, confirmation_hash: HASH, preview_token: 'short' }],
    [{ acknowledged: true, confirmation_hash: HASH.toUpperCase(), preview_token: TOKEN }],
    [{ acknowledged: true, confirmation_hash: `${HASH}0`, preview_token: TOKEN }],
    [{ acknowledged: false, confirmation_hash: HASH, preview_token: TOKEN }],
    [{ acknowledged: true, confirmation_hash: HASH, preview_token: TOKEN, account_version: 1 }],
  ])('rejects a non-contract confirm body %#', (body) => {
    expect(() => parseStoreDeletionConfirmBody(body)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
