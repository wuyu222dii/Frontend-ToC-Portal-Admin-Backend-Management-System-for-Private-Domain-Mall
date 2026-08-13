import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import type { PrincipalRequest } from '../access/principal';
import { requestContextStorage } from './request-context';

const CLIENT_REQUEST_ID_PATTERN = /^trace_[0-9a-f]{32}$/;

interface RequestIdRequest extends PrincipalRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

export function createRequestId(candidate: unknown): string {
  if (typeof candidate === 'string' && CLIENT_REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return `req_${randomUUID().replaceAll('-', '')}`;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestIdRequest, response: HeaderResponse, next: () => void): void {
    const requestId = createRequestId(request.headers['x-request-id']);
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    requestContextStorage.run({ requestId }, next);
  }
}
