import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  type HttpStatus,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import type { PrincipalRequest } from '../access/principal';

interface EnvelopeRequest extends PrincipalRequest {
  originalUrl?: string;
  url?: string;
}

interface StatusResponse {
  statusCode: HttpStatus;
}

export interface SuccessEnvelope<T> {
  code: 'OK';
  message: 'success';
  data: T;
  request_id: string;
}

const PRE_ENVELOPED_RESPONSE = Symbol('pre-enveloped-response');

export interface PreEnvelopedResponse<T> {
  readonly [PRE_ENVELOPED_RESPONSE]: true;
  readonly envelope: SuccessEnvelope<T>;
}

export function preEnvelopedResponse<T>(envelope: SuccessEnvelope<T>): PreEnvelopedResponse<T> {
  return { [PRE_ENVELOPED_RESPONSE]: true, envelope };
}

function isPreEnvelopedResponse<T>(value: unknown): value is PreEnvelopedResponse<T> {
  return typeof value === 'object' && value !== null &&
    (value as Partial<PreEnvelopedResponse<T>>)[PRE_ENVELOPED_RESPONSE] === true;
}

function isBusinessPath(request: EnvelopeRequest): boolean {
  const path = request.originalUrl ?? request.url ?? '';
  return path === '/api/v1' || path.startsWith('/api/v1/');
}

@Injectable()
export class SuccessEnvelopeInterceptor<T> implements NestInterceptor<T, T | SuccessEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T | SuccessEnvelope<T>> {
    const request = context.switchToHttp().getRequest<EnvelopeRequest>();
    const response = context.switchToHttp().getResponse<StatusResponse>();

    return next.handle().pipe(
      map((data) => {
        request.resultCode = 'OK';
        if (isPreEnvelopedResponse<T>(data)) return data.envelope;
        if (!isBusinessPath(request) || response.statusCode === 204) {
          return data;
        }

        return {
          code: 'OK',
          message: 'success',
          data,
          request_id: request.requestId ?? 'request_id_unavailable',
        };
      }),
    );
  }
}
