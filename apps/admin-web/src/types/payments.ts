import type { components } from '@qingxu/contracts';

export type PaymentReconciliationTask = components['schemas']['PaymentReconciliationView'];
export type PaymentReconciliationTaskType = PaymentReconciliationTask['task_type'];
export type PaymentIntentReconciliationStatus = 'CREATING' | 'OPEN' | 'CLOSE_PENDING';
export type PaymentRefundReconciliationStatus = 'PENDING' | 'PROCESSING' | 'FAILED';
export type PaymentReconciliationResolution = 'LATE_SUCCESS_REFUND_PENDING' | 'MANUAL_REQUIRED';
export type PaymentReconciliationConverged =
  components['schemas']['PaymentReconciliationConvergedResponse']['data'];

export interface PaymentReconciliationListQuery {
  page?: number;
  pageSize?: number;
  taskType?: PaymentReconciliationTaskType;
  intentStatus?: PaymentIntentReconciliationStatus;
  refundStatus?: PaymentRefundReconciliationStatus;
  paymentResolution?: PaymentReconciliationResolution;
  lastErrorCode?: string;
  dueBefore?: string;
}

export interface PaymentReconciliationListResult {
  items: PaymentReconciliationTask[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export type PaymentReconciliationActionResult =
  | {
      kind: 'CONVERGED';
      data: PaymentReconciliationConverged;
      requestId: string;
    }
  | {
      kind: 'PENDING';
      data: PaymentReconciliationTask;
      requestId: string;
    };
