import type {
  PaymentProviderPort,
  PaymentProviderIntentResult,
  PaymentProviderRefundResult,
  PaymentProviderRefundQueryResult,
  PaymentRefundQueryPort,
} from './types';

const UNAVAILABLE_INTENT: PaymentProviderIntentResult = {
  capability: null,
  failureCode: 'PROVIDER_UNAVAILABLE',
  occurredAt: null,
  outcome: 'UNKNOWN',
  providerEventId: null,
  providerIntentId: null,
  providerTransactionId: null,
};

const UNAVAILABLE_REFUND: PaymentProviderRefundResult = {
  failureCode: 'PROVIDER_UNAVAILABLE',
  occurredAt: null,
  outcome: 'UNKNOWN',
  providerEventId: null,
  providerRefundId: null,
};

const UNAVAILABLE_REFUND_QUERY: PaymentProviderRefundQueryResult = {
  ...UNAVAILABLE_REFUND,
  outcome: 'UNKNOWN',
};

export function unavailablePaymentProvider(): PaymentProviderPort & PaymentRefundQueryPort {
  return {
    close: async () => UNAVAILABLE_INTENT,
    create: async () => UNAVAILABLE_INTENT,
    query: async () => UNAVAILABLE_INTENT,
    queryRefund: async () => UNAVAILABLE_REFUND_QUERY,
    refund: async () => UNAVAILABLE_REFUND,
  };
}
