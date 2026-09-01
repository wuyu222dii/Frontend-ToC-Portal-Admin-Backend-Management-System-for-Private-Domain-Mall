import type { components, operations } from '@qingxu/contracts';

export type AdminAftersaleListItem = components['schemas']['AdminAftersaleListItem'];
export type AdminAftersaleDetail = components['schemas']['AdminAftersaleDetailResponse']['data'];
export type AdminAftersaleCommand = components['schemas']['AdminAftersaleResponse']['data'];
export type HighRiskPreview = components['schemas']['HighRiskPreviewResponse']['data'];
export type RefundResult = components['schemas']['RefundResponse']['data'];
export type ManualCompensationResult = components['schemas']['ManualCompensationResponse']['data'];
export type ReturnAddress = components['schemas']['ReturnAddressResponse']['data'];

export type AftersaleApproveInput = components['schemas']['AftersaleApproveRequest'];
export type ReturnInspectionInput = components['schemas']['ReturnInspectionRequest'];
export type ContinueRefundInput = components['schemas']['ContinueRefundRequest'];
export type RejectAfterReturnInput = components['schemas']['RejectAfterReturnPreviewRequest'];
export type RefundItemsInput = components['schemas']['RefundItemsAction'];
export type ManualCompensationInput = components['schemas']['ManualCompensationAction'];
export type ReturnAddressInput = components['schemas']['ReturnAddressAction'];
export type HighRiskConfirmationFields = components['schemas']['HighRiskConfirmationFields'];

export type AftersaleRejectInput =
  operations['postAdminAftersalesByAftersaleIdRejectPreview']['requestBody']['content']['application/json'];
export type RefundRetryInput =
  operations['postAdminRefundsByRefundIdRetryPreview']['requestBody']['content']['application/json'];

export interface AdminAftersaleListQuery {
  page?: number;
  pageSize?: number;
  aftersaleNo?: string;
  orderId?: string;
  status?: AdminAftersaleListItem['status'];
  type?: AdminAftersaleListItem['type'];
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
}

export interface AdminAftersaleListResult {
  items: AdminAftersaleListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export type RefundRetryResult = RefundResult | ManualCompensationResult;
