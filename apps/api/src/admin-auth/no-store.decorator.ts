import { applyDecorators, Header, SetMetadata } from '@nestjs/common';

export const NO_STORE_RESPONSE = Symbol('no-store-response');

export const NoStore = () => applyDecorators(
  SetMetadata(NO_STORE_RESPONSE, true),
  Header('Cache-Control', 'no-store, private'),
  Header('Pragma', 'no-cache'),
);
