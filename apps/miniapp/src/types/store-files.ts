import type { components } from '@qingxu/contracts';

type UploadIntentInput = components['schemas']['UploadIntentRequest'];

export interface StoreAftersaleEvidenceImageInput {
  readonly bytes: ArrayBuffer | Uint8Array;
  readonly filename: string;
  readonly mime_type: UploadIntentInput['mime_type'];
}

export type StoreUploadedAftersaleEvidence = components['schemas']['FileUploadCompleteResponse']['data'];
