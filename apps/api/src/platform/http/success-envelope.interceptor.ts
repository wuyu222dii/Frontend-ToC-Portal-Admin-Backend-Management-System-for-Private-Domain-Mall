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
