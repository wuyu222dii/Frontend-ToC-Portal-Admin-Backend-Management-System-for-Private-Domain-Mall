import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { Public } from '../platform/access/rbac.metadata';
import {
  parseStoreEmptyQuery,
  parseStoreProductId,
  parseStoreProductListQuery,
} from './store-catalog.dto';
import { StoreCatalogRateLimitGuard } from './store-catalog-rate-limit.guard';
import { StoreCatalogService } from './store-catalog.service';

@Controller('store')
@Public()
@UseGuards(StoreCatalogRateLimitGuard)
export class StoreCatalogController {
  constructor(@Inject(StoreCatalogService) private readonly catalog: StoreCatalogService) {}

  @Get('home')
  getHome(@Query() query: unknown) {
    parseStoreEmptyQuery(query);
    return this.catalog.getHome();
  }

  @Get('categories')
  listCategories(@Query() query: unknown) {
    parseStoreEmptyQuery(query);
    return this.catalog.listCategories();
  }

  @Get('brands')
  listBrands(@Query() query: unknown) {
    parseStoreEmptyQuery(query);
    return this.catalog.listBrands();
  }

  @Get('products')
  listProducts(@Query() query: unknown) {
    return this.catalog.listProducts(parseStoreProductListQuery(query));
  }

  @Get('products/:product_id')
  getProduct(@Param('product_id') productIdValue: string, @Query() query: unknown) {
    parseStoreEmptyQuery(query);
    return this.catalog.getProduct(parseStoreProductId(productIdValue));
  }
}
