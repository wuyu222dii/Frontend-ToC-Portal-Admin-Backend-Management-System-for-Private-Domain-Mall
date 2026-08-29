export const MOCK_PAYMENT_STATE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type PaymentProviderOutcome =
  | 'OPEN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'CLOSED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export type PaymentProviderFailureCode =
  | 'INVALID_PROVIDER_STATE'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_MISMATCH';

export interface PaymentProviderCapability {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
  expiresAt: Date;
}

export interface PaymentProviderIntentResult {
  outcome: PaymentProviderOutcome;
  providerIntentId: string | null;
  providerTransactionId: string | null;
  providerEventId: string | null;
  occurredAt: Date | null;
  failureCode: PaymentProviderFailureCode | null;
  capability: PaymentProviderCapability | null;
}

export interface PaymentProviderRefundResult {
  outcome: PaymentProviderOutcome;
  providerRefundId: string | null;
  providerEventId: string | null;
  occurredAt: Date | null;
  failureCode: PaymentProviderFailureCode | null;
}

export interface CreatePaymentIntentInput {
  intentNo: string;
  amount: string;
  expiresAt: Date;
}

export interface LocatePaymentIntentInput {
  intentNo: string;
  providerIntentId?: string | null;
}

export interface RefundPaymentInput {
  refundNo: string;
  providerIntentId: string;
  providerTransactionId: string;
  amount: string;
}

export interface PaymentProviderPort {
  create(input: CreatePaymentIntentInput): Promise<PaymentProviderIntentResult>;
  query(input: LocatePaymentIntentInput): Promise<PaymentProviderIntentResult>;
  close(input: LocatePaymentIntentInput): Promise<PaymentProviderIntentResult>;
  refund(input: RefundPaymentInput): Promise<PaymentProviderRefundResult>;
}

export type MockPaymentResult = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface SubmitMockPaymentResultInput extends LocatePaymentIntentInput {
  result: MockPaymentResult;
}

export interface MockPaymentCallbackPayload {
  version: 1;
  provider_event_id: string;
  provider_intent_id: string;
  provider_transaction_id: string | null;
  outcome: MockPaymentResult;
  amount: string;
  occurred_at: string;
}

export interface MockPaymentCallback {
  eventType: 'payment.cancelled' | 'payment.failed' | 'payment.succeeded';
  providerEventId: string;
  rawBody: Uint8Array;
  headers: {
    mock_signature: string;
    mock_timestamp: string;
  };
  payload: MockPaymentCallbackPayload;
}

export type SubmitMockPaymentResult =
  | {
      submission: 'ACCEPTED';
      payment: PaymentProviderIntentResult;
      callback: MockPaymentCallback;
    }
  | {
      submission: 'CONFLICT';
      payment: PaymentProviderIntentResult;
      callback: null;
    }
  | {
      submission: 'UNKNOWN';
      payment: PaymentProviderIntentResult;
      callback: null;
    };

export interface MockPaymentResultPort {
  submitResult(input: SubmitMockPaymentResultInput): Promise<SubmitMockPaymentResult>;
}

export interface PaymentRedisEvalPort {
  readonly isReady: boolean;
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
}

export interface MockPaymentProviderConfig {
  environment: 'development' | 'test';
  signingKey: Uint8Array;
  timeoutMs: number;
}
