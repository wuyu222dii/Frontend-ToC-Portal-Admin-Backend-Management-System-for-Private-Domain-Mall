import { SetMetadata } from '@nestjs/common';

export const OPTIONAL_STORE_AUTHENTICATION = Symbol('optional-store-authentication');

export const OptionalStoreAuthentication = () => SetMetadata(OPTIONAL_STORE_AUTHENTICATION, true);
