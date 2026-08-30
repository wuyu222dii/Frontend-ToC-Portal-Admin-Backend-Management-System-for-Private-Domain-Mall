export interface PaymentReconciliationAttempt {
  idempotencyKey: string;
  inFlight: boolean;
  uncertain: boolean;
}

export function beginPaymentReconciliationAttempt(
  current: PaymentReconciliationAttempt | undefined,
  createIdempotencyKey: () => string,
): PaymentReconciliationAttempt | null {
  if (current?.inFlight) return null;
  return {
    idempotencyKey: current?.uncertain ? current.idempotencyKey : createIdempotencyKey(),
    inFlight: true,
    uncertain: current?.uncertain ?? false,
  };
}

export function markPaymentReconciliationAttemptUncertain(
  attempt: PaymentReconciliationAttempt,
): PaymentReconciliationAttempt {
  return { ...attempt, inFlight: false, uncertain: true };
}
