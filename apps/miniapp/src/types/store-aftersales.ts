import type { components, operations } from '@qingxu/contracts';

export type AftersaleLineInput = components['schemas']['AftersaleLineInput'];
export type StoreAftersaleCreateInput = components['schemas']['CreateAftersaleRequest'];
export type StoreAftersalePreviewInput = Extract<StoreAftersaleCreateInput, { action: 'PREVIEW' }>;
export type StoreAftersaleConfirmInput = Extract<StoreAftersaleCreateInput, { action: 'CONFIRM' }>;
export type StoreAftersalePreview = operations['postStoreAftersales']['responses'][200]['content']['application/json']['data'];
export type StoreAftersale = components['schemas']['StoreAftersaleResponse']['data'];
export type StoreAftersaleListItem = components['schemas']['AftersaleListItem'];
export type StoreAftersaleList = components['schemas']['AftersaleListResponse']['data'];
export type StoreAftersaleDetail = components['schemas']['StoreAftersaleDetailResponse']['data'];
export type StoreAftersaleListQuery = NonNullable<
  operations['getStoreAftersales']['parameters']['query']
>;
export type StoreAftersaleCancelInput = operations['postStoreAftersalesByAftersaleIdCancel']['requestBody']['content']['application/json'];
export type StoreAftersaleReturnShipmentInput = components['schemas']['ReturnShipmentRequest'];
