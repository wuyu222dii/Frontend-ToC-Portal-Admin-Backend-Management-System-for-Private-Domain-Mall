import type { components } from '@qingxu/contracts';

export type PaymentIntent = components['schemas']['PaymentIntentResponse']['data'];
export type PaymentProviderCapability = components['schemas']['PaymentProviderCapabilityView'];
export type MockPaymentResultInput = components['schemas']['MockPaymentResultRequest'];
export type PaymentAttemptDetail = components['schemas']['PaymentAttemptDetailView'];
export type RefundAttemptDetail = components['schemas']['RefundAttemptDetailView'];
export type SafeDomainError = components['schemas']['SafeDomainErrorView'];
