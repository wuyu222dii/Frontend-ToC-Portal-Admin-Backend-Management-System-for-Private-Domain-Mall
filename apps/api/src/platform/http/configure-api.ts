import { RequestMethod, type INestApplication } from '@nestjs/common';

export const API_GLOBAL_PREFIX = 'api/v1';

export interface ConfigureApiOptions {
  trustedProxyCidrs?: readonly string[];
}

interface ExpressApplication {
  set(setting: 'trust proxy', value: boolean | readonly string[]): void;
}

export function configureApi(app: INestApplication, options: ConfigureApiOptions = {}): void {
  const trustedProxyCidrs = options.trustedProxyCidrs ?? [];
  const express = app.getHttpAdapter().getInstance() as ExpressApplication;
  express.set(
    'trust proxy',
    trustedProxyCidrs.length === 0 ? false : [...trustedProxyCidrs],
  );
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: [{ path: 'internal/health', method: RequestMethod.ALL }],
  });
}
