import type { PaymentIntent, PaymentProviderCapability } from '../types/store-payments';

export interface PaymentFlowMemory {
  readonly order_id: string;
  readonly payment_intent_id: string;
  readonly provider_payload: PaymentProviderCapability | null;
}

let currentFlow: PaymentFlowMemory | null = null;

function cloneCapability(
  capability: PaymentProviderCapability | null,
): PaymentProviderCapability | null {
  return capability === null ? null : { ...capability };
}

function cloneFlow(flow: PaymentFlowMemory): PaymentFlowMemory {
  return { ...flow, provider_payload: cloneCapability(flow.provider_payload) };
}

export function rememberPaymentFlow(orderId: string, intent: PaymentIntent): PaymentFlowMemory {
  currentFlow = {
    order_id: orderId,
    payment_intent_id: intent.payment_intent_id,
    provider_payload: cloneCapability(intent.provider_payload),
  };
  return cloneFlow(currentFlow);
}

export function peekPaymentFlow(orderId?: string): PaymentFlowMemory | null {
  if (currentFlow === null || (orderId !== undefined && currentFlow.order_id !== orderId)) return null;
  return cloneFlow(currentFlow);
}

export function clearPaymentFlow(orderId?: string): void {
  if (orderId === undefined || currentFlow?.order_id === orderId) currentFlow = null;
}
