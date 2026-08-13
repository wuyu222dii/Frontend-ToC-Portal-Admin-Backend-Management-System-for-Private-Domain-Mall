import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { parseIdempotencyKey } from '@qingxu/platform-core';

interface IdempotencyRequest {
  headers: Record<string, string | string[] | undefined>;
}

export function parseIdempotencyKeyHeader(value: string | string[] | undefined): string {
  return parseIdempotencyKey(typeof value === 'string' ? value : undefined);
}

export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<IdempotencyRequest>();
  return parseIdempotencyKeyHeader(request.headers['idempotency-key']);
});
