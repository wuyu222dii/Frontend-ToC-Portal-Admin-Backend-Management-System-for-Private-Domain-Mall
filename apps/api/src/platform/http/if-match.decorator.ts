import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { parseIfMatch } from '@qingxu/platform-core';

interface IfMatchRequest {
  headers: Record<string, string | string[] | undefined>;
}

export function parseIfMatchHeader(value: string | string[] | undefined): number {
  return parseIfMatch(typeof value === 'string' ? value : undefined);
}

export const IfMatchVersion = createParamDecorator((_data: unknown, context: ExecutionContext): number => {
  const request = context.switchToHttp().getRequest<IfMatchRequest>();
  return parseIfMatchHeader(request.headers['if-match']);
});
