export const APPLICATION_ERROR_HTTP_STATUS = {
  INVALID_ARGUMENT: 400,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  REAUTH_REQUIRED: 403,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_VERSION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  CONSENT_VERSION_MISMATCH: 409,
  ATTRIBUTION_CANDIDATE_MISMATCH: 409,
  CHECKOUT_QUOTE_EXPIRED: 409,
  CHECKOUT_QUOTE_MISMATCH: 409,
  CHECKOUT_REQUOTE_REQUIRED: 409,
  ORDER_NOT_CANCELLABLE: 409,
  ORDER_PAYMENT_EXPIRED: 409,
  PAYMENT_NOT_ALLOWED: 409,
  PAYMENT_RESULT_CONFLICT: 409,
  SOFT_DELETED_KEY_RESERVED: 409,
  PREVIEW_EXPIRED: 409,
  CONFIRMATION_MISMATCH: 409,
  STOCK_INSUFFICIENT: 422,
  AFTERSALE_QUOTA_EXCEEDED: 422,
  ACTIVE_PRODUCT_DEPENDENCY: 422,
  PRODUCT_PRIMARY_IMAGE_REQUIRED: 422,
  PRODUCT_ACTIVE_SKU_REQUIRED: 422,
  ACTIVE_SKU_DEPENDENCY: 422,
  ACTIVE_INVENTORY_RESERVATION: 422,
  INVENTORY_QUANTITY_OUT_OF_RANGE: 422,
  CART_ITEM_LIMIT_EXCEEDED: 422,
  DEFAULT_ADDRESS_REQUIRED: 422,
  FILE_CONTENT_MISMATCH: 422,
  ACCOUNT_DELETION_BLOCKED: 422,
  RATE_LIMITED: 429,
  REAUTH_LOCKED: 429,
  INTERNAL_ERROR: 500,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  PAYMENT_CONFIGURATION_UNAVAILABLE: 503,
} as const;

export const APPLICATION_ERROR_PUBLIC_MESSAGE: Readonly<Record<ApplicationErrorCode, string>> = {
  INVALID_ARGUMENT: 'The request is invalid',
  AUTH_REQUIRED: 'Authentication is required',
  SESSION_EXPIRED: 'The session has expired',
  PERMISSION_DENIED: 'Permission denied',
  REAUTH_REQUIRED: 'Reauthentication is required',
  RESOURCE_NOT_FOUND: 'Resource not found',
  RESOURCE_VERSION_CONFLICT: 'The resource version has changed',
  STATE_CONFLICT: 'The resource state conflicts with this request',
  CONSENT_VERSION_MISMATCH: 'The accepted legal document version is not current',
  ATTRIBUTION_CANDIDATE_MISMATCH: 'The attribution candidate does not match this request',
  CHECKOUT_QUOTE_EXPIRED: 'The checkout quote has expired',
  CHECKOUT_QUOTE_MISMATCH: 'The checkout quote does not match this request',
  CHECKOUT_REQUOTE_REQUIRED: 'The checkout facts have changed; request a new quote',
  ORDER_NOT_CANCELLABLE: 'The order cannot be cancelled',
  ORDER_PAYMENT_EXPIRED: 'The order payment window has expired',
  PAYMENT_NOT_ALLOWED: 'Payment is not allowed for this order',
  PAYMENT_RESULT_CONFLICT: 'The payment result conflicts with the current state',
  SOFT_DELETED_KEY_RESERVED: 'The archived business key is reserved',
  PREVIEW_EXPIRED: 'The confirmation preview has expired',
  CONFIRMATION_MISMATCH: 'The confirmation does not match the preview',
  STOCK_INSUFFICIENT: 'Stock is insufficient',
  AFTERSALE_QUOTA_EXCEEDED: 'The aftersale quantity or amount exceeds the available quota',
  ACTIVE_PRODUCT_DEPENDENCY: 'Active products must be deactivated or moved first',
  PRODUCT_PRIMARY_IMAGE_REQUIRED: 'A product requires at least one ready public image',
  PRODUCT_ACTIVE_SKU_REQUIRED: 'A product requires at least one active SKU',
  ACTIVE_SKU_DEPENDENCY: 'Active SKUs must be deactivated first',
  ACTIVE_INVENTORY_RESERVATION: 'Active inventory reservations must be released first',
  INVENTORY_QUANTITY_OUT_OF_RANGE: 'The resulting inventory quantity is outside the supported range',
  CART_ITEM_LIMIT_EXCEEDED: 'The cart cannot contain more than 100 distinct SKUs',
  DEFAULT_ADDRESS_REQUIRED: 'An active address must remain the default address',
  FILE_CONTENT_MISMATCH: 'The uploaded file does not match its declaration',
  ACCOUNT_DELETION_BLOCKED: 'Account deletion is blocked by unsettled activity',
  RATE_LIMITED: 'Too many requests',
  REAUTH_LOCKED: 'Reauthentication is temporarily locked',
  INTERNAL_ERROR: 'An unexpected error occurred',
  PAYMENT_PROVIDER_UNAVAILABLE: 'The payment service is temporarily unavailable',
  PAYMENT_CONFIGURATION_UNAVAILABLE: 'Payment is temporarily unavailable',
};

export type ApplicationErrorCode = keyof typeof APPLICATION_ERROR_HTTP_STATUS;
export type ApplicationErrorHttpStatus = (typeof APPLICATION_ERROR_HTTP_STATUS)[ApplicationErrorCode];

export interface ApplicationErrorDetail {
  field: string | null;
  reason: string;
  rejected_value?: string | null;
}

export interface ApplicationErrorResponse {
  code: ApplicationErrorCode;
  message: string;
  details?: ApplicationErrorDetail[];
  request_id: string;
}

const SAFE_ERROR_REASON = 'The value was rejected';
const REGISTERED_ERROR_FIELD = new Map([
  ['Idempotency-Key', 'Idempotency-Key'],
  ['If-Match', 'If-Match'],
  ['headers.idempotency_key', 'headers.idempotency_key'],
  ['headers.if_match', 'headers.if_match'],
  ['quantity', 'quantity'],
  ['status', 'status'],
]);

function safeErrorField(value: string | null): string | null {
  if (value === null) return null;
  return REGISTERED_ERROR_FIELD.get(value) ?? null;
}

function sanitizeDetail(detail: ApplicationErrorDetail): ApplicationErrorDetail {
  const field = safeErrorField(detail.field);
  if (detail.rejected_value === undefined) return { field, reason: SAFE_ERROR_REASON };
  return {
    field,
    reason: SAFE_ERROR_REASON,
    rejected_value: null,
  };
}

export function getApplicationErrorHttpStatus(code: ApplicationErrorCode): ApplicationErrorHttpStatus {
  return APPLICATION_ERROR_HTTP_STATUS[code];
}

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly details: readonly ApplicationErrorDetail[];
  readonly httpStatus: ApplicationErrorHttpStatus;

  constructor(
    code: ApplicationErrorCode,
    _internalMessage: string,
    details: readonly ApplicationErrorDetail[] = [],
    options?: ErrorOptions,
  ) {
    const httpStatus = getApplicationErrorHttpStatus(code);
    const publicMessage = APPLICATION_ERROR_PUBLIC_MESSAGE[code];
    super(publicMessage, options);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = httpStatus >= 500 ? [] : details.map(sanitizeDetail);
    this.httpStatus = httpStatus;
  }

  toResponse(requestId: string): ApplicationErrorResponse {
    const response: ApplicationErrorResponse = {
      code: this.code,
      message: this.message,
      request_id: requestId,
    };

    if (this.details.length > 0) {
      response.details = [...this.details];
    }

    return response;
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
