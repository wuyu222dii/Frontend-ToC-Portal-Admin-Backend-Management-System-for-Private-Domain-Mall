import { adminSessionRequest, newIdempotencyKey } from './admin-api';
import {
  decodeHighRiskPreviewResponse,
  decodeReturnAddressResponse,
} from './admin-aftersales-decoders';
import type {
  HighRiskConfirmationFields,
  HighRiskPreview,
  ReturnAddress,
  ReturnAddressInput,
} from './admin-aftersales-types';

export type {
  HighRiskPreview,
  ReturnAddress,
  ReturnAddressInput,
} from './admin-aftersales-types';

const returnAddressPath = '/admin/settings/return-address';

function confirmation(
  input: ReturnAddressInput,
  preview: HighRiskPreview,
): ReturnAddressInput & HighRiskConfirmationFields {
  return {
    ...input,
    confirmation_hash: preview.confirmation_hash,
    preview_token: preview.preview_token,
  };
}

export async function getAdminReturnAddress(signal?: AbortSignal): Promise<ReturnAddress> {
  const response = await adminSessionRequest<unknown>(returnAddressPath, {
    expectedStatus: 200,
    signal,
  });
  return decodeReturnAddressResponse(response);
}

export async function previewAdminReturnAddress(
  input: ReturnAddressInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${returnAddressPath}/preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminReturnAddress(
  input: ReturnAddressInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<ReturnAddress> {
  const response = await adminSessionRequest<unknown>(returnAddressPath, {
    body: confirmation(input, preview),
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'PATCH',
    signal,
  });
  return decodeReturnAddressResponse(response);
}
