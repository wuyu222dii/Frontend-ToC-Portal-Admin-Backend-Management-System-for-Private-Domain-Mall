import { RequestMethod, type INestApplication } from '@nestjs/common';

export const API_GLOBAL_PREFIX = 'api/v1';

export function configureApi(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: [{ path: 'internal/health', method: RequestMethod.ALL }],
  });
}
