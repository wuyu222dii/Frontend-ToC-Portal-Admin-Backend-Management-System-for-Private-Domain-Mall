import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { redactLogValue, type RbacPrincipal } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../access/principal';

interface AccessLogRequest extends PrincipalRequest {
  method?: string;
  route?: { path?: unknown };
}

interface FinishResponse {
  once(event: 'finish', listener: () => void): void;
  statusCode: number;
}

export interface AccessLogEntry {
  account_id?: string;
  actor_role?: RbacPrincipal['role'];
  duration_ms: number;
  method: string;
  request_id: string;
  result_code: string;
  route: string;
  service: 'api';
  session_id?: string;
  status_code: number;
}

export function createAccessLogEntry(
  request: AccessLogRequest,
  response: Pick<FinishResponse, 'statusCode'>,
  durationMs: number,
): AccessLogEntry {
  const entry: AccessLogEntry = {
    duration_ms: Math.max(0, Math.round(durationMs)),
    method: request.method ?? 'UNKNOWN',
    request_id: request.requestId ?? 'request_id_unavailable',
    result_code: request.resultCode ?? (response.statusCode < 400 ? 'OK' : 'UNCLASSIFIED_ERROR'),
    route: typeof request.route?.path === 'string' ? request.route.path : 'UNMATCHED',
    service: 'api',
    status_code: response.statusCode,
  };

  if (request.principal !== undefined) {
    entry.actor_role = request.principal.role;
    if (request.principal.role !== 'CUSTOMER') {
      entry.account_id = request.principal.accountId;
      entry.session_id = request.principal.sessionId;
    }
  }

  return redactLogValue(entry) as AccessLogEntry;
}

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HttpAccess');

  use(request: AccessLogRequest, response: FinishResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.log(createAccessLogEntry(request, response, durationMs));
    });
    next();
  }
}
