import {
  Catch,
  HttpException,
  Inject,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ApplicationError,
  redactLogValue,
  type ApplicationErrorCode,
  type ApplicationErrorDetail,
  type ApplicationErrorResponse,
} from '@qingxu/platform-core';

import type { PrincipalRequest } from '../access/principal';
import { createRequestId } from './request-id.middleware';

interface ErrorRequest extends PrincipalRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface ResolvedError {
  code: ApplicationErrorCode;
  details?: readonly ApplicationErrorDetail[];
  message: string;
  status: number;
}

const HTTP_ERROR_MAP: Readonly<Record<number, Omit<ResolvedError, 'status'>>> = {
  400: { code: 'INVALID_ARGUMENT', message: 'The request is invalid' },
  401: { code: 'AUTH_REQUIRED', message: 'Authentication is required' },
  403: { code: 'PERMISSION_DENIED', message: 'Permission denied' },
  404: { code: 'RESOURCE_NOT_FOUND', message: 'Resource not found' },
  409: { code: 'STATE_CONFLICT', message: 'The resource state conflicts with this request' },
  422: { code: 'INVALID_ARGUMENT', message: 'The request failed business validation' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
};

function frameworkClientStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const record = exception as Record<string, unknown>;
  for (const candidate of [record.status, record.statusCode]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate < 500) {
      return candidate;
    }
  }
  return undefined;
}

function resolveError(exception: unknown): ResolvedError {
  if (exception instanceof ApplicationError) {
    return {
      code: exception.code,
      details: exception.details,
      message: exception.message,
      status: exception.httpStatus,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const mapped = HTTP_ERROR_MAP[status];
    if (mapped !== undefined) {
      return { ...mapped, status };
    }
    if (status >= 400 && status < 500) {
      return {
        code: 'INVALID_ARGUMENT',
        message: 'The request is invalid',
        status,
      };
    }
  }

  const clientStatus = frameworkClientStatus(exception);
  if (clientStatus !== undefined) {
    return {
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      status: clientStatus,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    status: 500,
  };
}

function toErrorResponse(error: ResolvedError, requestId: string): ApplicationErrorResponse {
  const response: ApplicationErrorResponse = {
    code: error.code,
    message: error.message,
    request_id: requestId,
  };
  if (error.details !== undefined && error.details.length > 0) {
    response.details = [...error.details];
  }
  return response;
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ErrorRequest>();
    const response = context.getResponse<unknown>();
    const requestId = request.requestId ?? createRequestId(request.headers?.['x-request-id']);
    const error = resolveError(exception);

    request.requestId = requestId;
    request.resultCode = error.code;
    if (error.status >= 500) {
      this.logger.error(
        redactLogValue({
          error_code: error.code,
          http_status: error.status,
          request_id: requestId,
          service: 'api',
        }),
      );
    }
    this.adapterHost.httpAdapter.setHeader(response, 'X-Request-Id', requestId);
    this.adapterHost.httpAdapter.reply(response, toErrorResponse(error, requestId), error.status);
  }
}
