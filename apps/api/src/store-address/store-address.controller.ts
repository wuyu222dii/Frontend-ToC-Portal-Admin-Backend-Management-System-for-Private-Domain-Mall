import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery, parseStoreEmptyBody } from '../store-auth/store-auth.dto';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import { parseStoreAddressId, parseStoreAddressWriteBody } from './store-address.dto';
import { StoreAddressService } from './store-address.service';

@Controller('store/addresses')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreAddressController {
  constructor(@Inject(StoreAddressService) private readonly addresses: StoreAddressService) {}

  @Get()
  @NoStore()
  list(
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.addresses.listAddresses(requireStoreSession(request));
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @NoStore()
  create(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.addresses.createAddress(
      requireStoreSession(request),
      parseStoreAddressWriteBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Get(':address_id')
  @NoStore()
  get(
    @Param('address_id') addressIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.addresses.getAddress(
      requireStoreSession(request),
      parseStoreAddressId(addressIdValue),
    );
  }

  @Patch(':address_id')
  @NoStore()
  update(
    @Param('address_id') addressIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.addresses.updateAddress(
      requireStoreSession(request),
      parseStoreAddressId(addressIdValue),
      parseStoreAddressWriteBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Delete(':address_id')
  @NoStore()
  delete(
    @Param('address_id') addressIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.addresses.deleteAddress(
      requireStoreSession(request),
      parseStoreAddressId(addressIdValue),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
