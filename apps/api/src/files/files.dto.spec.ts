import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import { parseFileId, parseUploadCompleteBody, parseUploadIntentBody } from './files.dto';

const sha256 = 'a'.repeat(64);

describe('file request DTOs', () => {
  it('accepts only the six external image intent purposes', () => {
    expect(parseUploadIntentBody({
      filename: 'brand-logo.png',
      mime_type: 'image/png',
      purpose: 'BRAND_LOGO',
      sha256,
      size: 5_242_880,
    })).toEqual({
      filename: 'brand-logo.png', mimeType: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 5_242_880,
    });
  });

  it.each([
    { filename: ' ', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 1 },
    { filename: 'logo\n.png', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 1 },
    { filename: 'logo.gif', mime_type: 'image/gif', purpose: 'BRAND_LOGO', sha256, size: 1 },
    { filename: 'qr.png', mime_type: 'image/png', purpose: 'PROMOTION_QR', sha256, size: 1 },
    { filename: 'logo.png', mime_type: 'image/png', purpose: 'UNREGISTERED', sha256, size: 1 },
    { filename: 'logo.png', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256: 'A'.repeat(64), size: 1 },
    { filename: 'logo.png', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 5_242_881 },
    { filename: 'logo.png', mime_type: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 1, extra: true },
  ])('rejects an invalid or open upload intent body', (body) => {
    expect(() => parseUploadIntentBody(body)).toThrowError(ApplicationError);
  });

  it('keeps complete closed and validates the file path as a ULID', () => {
    expect(parseUploadCompleteBody({ sha256, size: 25 })).toEqual({ sha256, size: 25 });
    expect(() => parseUploadCompleteBody({ sha256, size: 25, extra: true })).toThrowError(ApplicationError);
    expect(parseFileId('01J00000000000000000000000')).toBe('01J00000000000000000000000');
    expect(() => parseFileId('../private/key')).toThrowError(ApplicationError);
  });
});
