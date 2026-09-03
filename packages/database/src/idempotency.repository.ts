import {
  ApplicationError,
  canonicalJson,
  generateUlid,
  hmacCanonicalJson,
  isValidUlid,
  sha256Hex,
} from '@qingxu/platform-core';
import { timingSafeEqual } from 'node:crypto';

import { Prisma } from '../.generated/prisma/client';
import type { IdempotencyRecordModel as IdempotencyRecord } from '../.generated/prisma/models/IdempotencyRecord';
import { acquireTransactionLock } from './advisory-lock';

export type DatabaseTransaction = Prisma.TransactionClient;

export interface IdempotencyHashKey {
  id: string;
  key: Uint8Array;
}

export interface IdempotencyHashKeyRing {
  current: IdempotencyHashKey;
  previous: readonly IdempotencyHashKey[];
}

export interface IdempotencyClaim {
  actorId: string;
  idempotencyKey: string;
  request: IdempotencyRequestDescriptor;
}

export interface IdempotencyRequestDescriptor {
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
  route: string;
  pathParameters: Record<string, string>;
  body: unknown;
}

export type IdempotencyClaimResult =
  | { kind: 'execute' }
  | { kind: 'replay'; record: IdempotencyRecord };

interface IdempotencyResultBase {
  responseStatus: number;
}

export type IdempotencyResult =
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'COMMAND_RESPONSE';
      responseBody: CacheableCommandResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'FILE_UPLOAD_COMPLETE';
      responseBody: CacheableFileUploadCompleteResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'CATALOG_RESOURCE_RESPONSE';
      responseBody: CacheableCatalogResourceResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'PRODUCT_CATALOG_RESPONSE';
      responseBody: CacheableProductCatalogResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'BANNER_RESOURCE_RESPONSE';
      responseBody: CacheableBannerResourceResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'AGENT_RESOURCE_RESPONSE';
      responseBody: CacheableAgentResourceResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'AGENT_PRODUCT_AUTHORIZATION_RESPONSE';
      responseBody: CacheableAgentProductAuthorizationResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'AGENT_INVITE_ROTATE_REPLAY';
      responseBody: CacheableAgentInviteRotateReplay;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'ADMIN_CUSTOMER_RESPONSE';
      responseBody: CacheableAdminCustomerResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'HASH_ONLY';
      resourceId?: string;
      responseForHash: unknown;
    });

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
export interface CacheableCommandResponse {
  code: 'OK';
  message: 'success';
  data: {
    resource_type: string;
    resource_id: string;
    status: string;
    version: number;
    occurred_at: string;
  };
  request_id: string;
}

export type CacheableFilePurpose =
  | 'PRODUCT_IMAGE'
  | 'BRAND_LOGO'
  | 'CATEGORY_ICON'
  | 'BANNER'
  | 'AFTERSALE_EVIDENCE'
  | 'WITHDRAWAL_PROOF'
  | 'PROMOTION_QR';

export interface CacheableFileUploadCompleteResponse {
  code: 'OK';
  message: 'success';
  data: {
    file_id: string;
    purpose: CacheableFilePurpose;
    status: 'READY';
    public_url: string | null;
    completed_at: string;
  };
  request_id: string;
}

export interface CacheableBrandView {
  brand_id: string;
  name: string;
  description: string | null;
  logo_file_id: string | null;
  logo_url: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  sort_order: number;
  version: number;
}

export interface CacheableCategoryView {
  category_id: string;
  name: string;
  icon_file_id: string | null;
  icon_url: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  sort_order: number;
  version: number;
}

export type CacheableCatalogResourceResponse = {
  code: 'OK';
  message: 'success';
  request_id: string;
} & ({ data: CacheableBrandView } | { data: CacheableCategoryView });

export interface CacheableProductImageView {
  file_id: string;
  url: string;
  sort_order: number;
  is_primary: boolean;
}

export interface CacheableSkuSpec {
  attributes: Array<{ name: string; value: string }>;
}

export interface CacheableSkuView {
  sku_id: string;
  code: string;
  name: string;
  spec_json: CacheableSkuSpec | null;
  retail_price: string;
  is_recommended: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  available_stock: number;
  version: number;
}

export interface CacheableProductDetailView {
  product_id: string;
  spu_code: string;
  name: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usage_method: string | null;
  brand: CacheableBrandView;
  category: CacheableCategoryView;
  images: CacheableProductImageView[];
  skus: CacheableSkuView[];
  net_sales_count: number;
  is_hot: boolean;
  is_new: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  version: number;
}

export type CacheableProductCatalogResponse = {
  code: 'OK';
  message: 'success';
  request_id: string;
} & ({ data: CacheableProductDetailView } | { data: CacheableSkuView });

interface CacheableBannerViewBase {
  banner_id: string;
  title: string;
  file_id: string;
  image_url: string;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  version: number;
}

export type CacheableBannerView = CacheableBannerViewBase & (
  | { target_type: 'NONE'; target_id: null; target_url: null }
  | { target_type: 'PRODUCT' | 'CATEGORY'; target_id: string; target_url: null }
  | { target_type: 'URL'; target_id: null; target_url: string }
);

export interface CacheableBannerResourceResponse {
  code: 'OK';
  message: 'success';
  data: CacheableBannerView;
  request_id: string;
}

export interface CacheableAgentView {
  agent_id: string;
  agent_no: string;
  name: string;
  contact_name: string | null;
  contact_phone_tail: string | null;
  status: 'ACTIVE' | 'DISABLED';
  product_authorization_mode: 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';
  version: number;
}

export interface CacheableAgentResourceResponse {
  code: 'OK';
  message: 'success';
  data: CacheableAgentView;
  request_id: string;
}

export interface CacheableAgentProductAuthorizationResponse {
  code: 'OK';
  message: 'success';
  data: {
    agent_id: string;
    mode: 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';
    product_ids: string[];
    version: number;
  };
  request_id: string;
}

export interface CacheableAgentInviteRotateReplay {
  code: 'OK';
  message: 'success';
  data: {
    agent_id: string;
    new_invite_code: null;
    old_code_invalidated: {
      invite_code_id: string;
      code_masked: string;
      invalidated_at: string;
      existing_bindings_unchanged: true;
    };
    disclosure_state: 'REPLAY_REDACTED';
    reissue_required: true;
  };
  request_id: string;
}

export interface CacheableAttributionBindingView {
  binding_id: string;
  customer_id: string;
  agent_id: string;
  agent_name: string;
  started_at: string;
  customer_version: number;
}

export interface CacheableAdminCustomerView {
  customer_id: string;
  customer_alias: string;
  account_status: 'ACTIVE' | 'DISABLED' | 'DELETION_PENDING' | 'ANONYMIZED';
  nickname_masked: string | null;
  phone_masked: string | null;
  city?: string | null;
  consumption_amount: string;
  consumption_count: number;
  registered_at: string;
  last_product_name: string | null;
  last_purchase_at: string | null;
  last_order_id: string | null;
  management_note_present: boolean;
  binding: CacheableAttributionBindingView | null;
  deletion_request_status: 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | null;
  version: number;
}

export interface CacheableAdminCustomerResponse {
  code: 'OK';
  message: 'success';
  data: CacheableAdminCustomerView;
  request_id: string;
}

const COMMAND_RESPONSE_TOP_LEVEL_FIELDS = new Set(['code', 'data', 'message', 'request_id']);
const COMMAND_RESPONSE_DATA_FIELDS = new Set([
  'occurred_at',
  'resource_id',
  'resource_type',
  'status',
  'version',
]);
const FILE_UPLOAD_COMPLETE_TOP_LEVEL_FIELDS = new Set(['code', 'data', 'message', 'request_id']);
const FILE_UPLOAD_COMPLETE_DATA_FIELDS = new Set([
  'completed_at',
  'file_id',
  'public_url',
  'purpose',
  'status',
]);
const CATALOG_RESPONSE_TOP_LEVEL_FIELDS = new Set(['code', 'data', 'message', 'request_id']);
const BRAND_VIEW_FIELDS = new Set([
  'brand_id',
  'description',
  'logo_file_id',
  'logo_url',
  'name',
  'sort_order',
  'status',
  'version',
]);
const CATEGORY_VIEW_FIELDS = new Set([
  'category_id',
  'icon_file_id',
  'icon_url',
  'name',
  'sort_order',
  'status',
  'version',
]);
const PRODUCT_DETAIL_VIEW_FIELDS = new Set([
  'brand',
  'category',
  'images',
  'ingredients',
  'introduction',
  'is_hot',
  'is_new',
  'name',
  'net_sales_count',
  'product_id',
  'skus',
  'spu_code',
  'status',
  'subtitle',
  'usage_method',
  'version',
]);
const PRODUCT_IMAGE_VIEW_FIELDS = new Set(['file_id', 'is_primary', 'sort_order', 'url']);
const SKU_VIEW_FIELDS = new Set([
  'available_stock',
  'code',
  'is_recommended',
  'name',
  'retail_price',
  'sku_id',
  'spec_json',
  'status',
  'version',
]);
const SKU_SPEC_FIELDS = new Set(['attributes']);
const SKU_ATTRIBUTE_FIELDS = new Set(['name', 'value']);
const BANNER_VIEW_FIELDS = new Set([
  'banner_id',
  'ends_at',
  'file_id',
  'image_url',
  'sort_order',
  'starts_at',
  'status',
  'target_id',
  'target_type',
  'target_url',
  'title',
  'version',
]);
const AGENT_VIEW_FIELDS = new Set([
  'agent_id',
  'agent_no',
  'contact_name',
  'contact_phone_tail',
  'name',
  'product_authorization_mode',
  'status',
  'version',
]);
const AGENT_PRODUCT_AUTHORIZATION_FIELDS = new Set(['agent_id', 'mode', 'product_ids', 'version']);
const AGENT_INVITE_ROTATE_FIELDS = new Set([
  'agent_id',
  'disclosure_state',
  'new_invite_code',
  'old_code_invalidated',
  'reissue_required',
]);
const ADMIN_CUSTOMER_VIEW_FIELDS = new Set([
  'account_status',
  'binding',
  'city',
  'consumption_amount',
  'consumption_count',
  'customer_alias',
  'customer_id',
  'deletion_request_status',
  'last_order_id',
  'last_product_name',
  'last_purchase_at',
  'management_note_present',
  'nickname_masked',
  'phone_masked',
  'registered_at',
  'version',
]);
const ADMIN_CUSTOMER_VIEW_FIELDS_WITHOUT_CITY = new Set(
  [...ADMIN_CUSTOMER_VIEW_FIELDS].filter((field) => field !== 'city'),
);
const ATTRIBUTION_BINDING_VIEW_FIELDS = new Set([
  'agent_id',
  'agent_name',
  'binding_id',
  'customer_id',
  'customer_version',
  'started_at',
]);
const INVALIDATED_INVITE_FIELDS = new Set([
  'code_masked',
  'existing_bindings_unchanged',
  'invalidated_at',
  'invite_code_id',
]);
const CATALOG_STATUS = new Set(['ACTIVE', 'ARCHIVED', 'DRAFT', 'INACTIVE']);
const SKU_STATUS = new Set(['ACTIVE', 'ARCHIVED', 'INACTIVE']);
const BANNER_STATUS = new Set(['ACTIVE', 'ARCHIVED', 'DRAFT', 'INACTIVE']);
const AGENT_STATUS = new Set(['ACTIVE', 'DISABLED']);
const AGENT_AUTHORIZATION_MODE = new Set(['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST']);
const CUSTOMER_ACCOUNT_STATUS = new Set(['ACTIVE', 'ANONYMIZED', 'DELETION_PENDING', 'DISABLED']);
const CUSTOMER_DELETION_STATUS = new Set(['COMPLETED', 'PROCESSING', 'REJECTED', 'SUBMITTED']);
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const MASKED_PHONE = /^\*{3} \*{4} [0-9]{4}$/;
const FILE_PURPOSE = new Set<CacheableFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
  'AFTERSALE_EVIDENCE',
  'WITHDRAWAL_PROOF',
  'PROMOTION_QR',
]);
const PUBLIC_FILE_PURPOSE = new Set<CacheableFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
]);
const COMMAND_RESPONSE_STATUS = new Set([
  'ACTIVE',
  'ANONYMIZED',
  'APPROVED',
  'ARCHIVED',
  'CANCELLED',
  'CLOSED',
  'COMPLETED',
  'DELETED',
  'DISABLED',
  'DRAFT',
  'EXPIRED',
  'FAILED',
  'INACTIVE',
  'PAID',
  'PENDING',
  'PROCESSED',
  'PUBLISHED',
  'READY',
  'RECEIVED',
  'REJECTED',
  'REVOKED',
  'ROTATED',
  'SUCCEEDED',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUEST_ID = /^(?:req|trace)_[0-9a-f]{32}$/;
const COMMAND_RESPONSE_RESOURCE_TYPE = new Set([
  'account',
  'agent',
  'aftersale',
  'banner',
  'binding',
  'brand',
  'business_rule',
  'cart',
  'category',
  'commission_rule',
  'customer',
  'file',
  'integration_fixture',
  'inventory',
  'order',
  'payment',
  'product',
  'promotion',
  'refund',
  'session',
  'shipment',
  'sku',
  'withdrawal',
]);
const MUTATION_METHOD = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
const CLAIM_FIELDS = new Set(['actorId', 'idempotencyKey', 'request']);
const REQUEST_DESCRIPTOR_FIELDS = new Set(['body', 'method', 'pathParameters', 'route']);
const REQUEST_SCOPE_DESCRIPTOR_FIELDS = new Set(['method', 'route']);
const CACHEABLE_RESULT_FIELDS = new Set(['policy', 'responseBody', 'responseStatus', 'storage']);
const HASH_ONLY_RESULT_FIELDS = new Set(['resourceId', 'responseForHash', 'responseStatus', 'storage']);
const HASH_KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const IDEMPOTENCY_SCOPE = /^idempotency:v1:[a-f0-9]{64}$/;
const MAX_PREVIOUS_HASH_KEYS = 3;

interface ResponseIntegrityContext {
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  scope: string;
}

export function deriveIdempotencyScope(
  request: Pick<IdempotencyRequestDescriptor, 'method' | 'route'>,
): string {
  const digest = sha256Hex(canonicalJson({ method: request.method, route: request.route }));
  return `idempotency:v1:${digest}`;
}

function validateRequestScopeDescriptor(
  request: Pick<IdempotencyRequestDescriptor, 'method' | 'route'>,
): void {
  if (!isExactPlainObject(request, REQUEST_SCOPE_DESCRIPTOR_FIELDS) ||
    !MUTATION_METHOD.has(request.method) ||
    !/^\/[^?#]{0,159}$/.test(request.route)) {
    throw new TypeError('Idempotency request scope descriptor is invalid');
  }
}

function isExactPlainObject(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isCacheableCommandResponse(value: unknown): value is CacheableCommandResponse {
  if (!isExactPlainObject(value, COMMAND_RESPONSE_TOP_LEVEL_FIELDS)) return false;
  if (value.code !== 'OK' || value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  if (!isExactPlainObject(value.data, COMMAND_RESPONSE_DATA_FIELDS)) return false;
  return typeof value.data.resource_type === 'string' &&
    COMMAND_RESPONSE_RESOURCE_TYPE.has(value.data.resource_type) &&
    isValidUlid(value.data.resource_id) &&
    typeof value.data.status === 'string' && COMMAND_RESPONSE_STATUS.has(value.data.status) &&
    Number.isSafeInteger(value.data.version) && Number(value.data.version) >= 1 &&
    typeof value.data.occurred_at === 'string' && ISO_TIMESTAMP.test(value.data.occurred_at);
}

function isStablePublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' && url.password === '' && url.search === '' && url.hash === '';
}

function isPublicFileUrl(value: unknown, fileId: string): value is string {
  if (!isStablePublicUrl(value)) return false;
  return new URL(value).pathname.endsWith(`/public/${fileId}`);
}

function isCatalogName(value: unknown): value is string {
  return typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= 120 &&
    value.trim().length > 0;
}

function isCatalogState(status: unknown, sortOrder: unknown, version: unknown): boolean {
  return typeof status === 'string' && CATALOG_STATUS.has(status) &&
    Number.isSafeInteger(sortOrder) && Number(sortOrder) >= 0 && Number(sortOrder) <= 2_147_483_647 &&
    Number.isSafeInteger(version) && Number(version) >= 1 && Number(version) <= 2_147_483_647;
}

function validPublicFilePair(fileId: unknown, fileUrl: unknown): boolean {
  if (fileId === null) return fileUrl === null;
  return typeof fileId === 'string' && isValidUlid(fileId) && isPublicFileUrl(fileUrl, fileId);
}

function isCacheableBrandView(value: unknown): value is CacheableBrandView {
  if (!isExactPlainObject(value, BRAND_VIEW_FIELDS)) return false;
  return isValidUlid(value.brand_id) && isCatalogName(value.name) &&
    (value.description === null ||
      (typeof value.description === 'string' && Array.from(value.description).length <= 500)) &&
    validPublicFilePair(value.logo_file_id, value.logo_url) &&
    isCatalogState(value.status, value.sort_order, value.version);
}

function isCacheableCategoryView(value: unknown): value is CacheableCategoryView {
  if (!isExactPlainObject(value, CATEGORY_VIEW_FIELDS)) return false;
  return isValidUlid(value.category_id) && isCatalogName(value.name) &&
    validPublicFilePair(value.icon_file_id, value.icon_url) &&
    isCatalogState(value.status, value.sort_order, value.version);
}

function isCacheableCatalogResourceResponse(value: unknown): value is CacheableCatalogResourceResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  return isCacheableBrandView(value.data) || isCacheableCategoryView(value.data);
}

function isBoundedNonBlankString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value).length >= 1 && Array.from(value).length <= maximum;
}

function isNullableBoundedString(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && Array.from(value).length <= maximum);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2_147_483_647;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && ISO_TIMESTAMP.test(value));
}

function isHttpsTargetUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '';
}

function isCacheableBannerView(value: unknown): value is CacheableBannerView {
  if (!isExactPlainObject(value, BANNER_VIEW_FIELDS) ||
    !isValidUlid(value.banner_id) ||
    !isBoundedNonBlankString(value.title, 160) ||
    !isValidUlid(value.file_id) ||
    !isPublicFileUrl(value.image_url, value.file_id) ||
    !isNonNegativeInteger(value.sort_order) ||
    !isNullableTimestamp(value.starts_at) ||
    !isNullableTimestamp(value.ends_at) ||
    typeof value.status !== 'string' || !BANNER_STATUS.has(value.status) ||
    !isPositiveInteger(value.version)) return false;
  if (value.target_type === 'NONE') return value.target_id === null && value.target_url === null;
  if (value.target_type === 'PRODUCT' || value.target_type === 'CATEGORY') {
    return typeof value.target_id === 'string' && isValidUlid(value.target_id) && value.target_url === null;
  }
  return value.target_type === 'URL' && value.target_id === null && isHttpsTargetUrl(value.target_url);
}

function isCacheableBannerResourceResponse(value: unknown): value is CacheableBannerResourceResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  return isCacheableBannerView(value.data);
}

function isCacheableAgentView(value: unknown): value is CacheableAgentView {
  if (!isExactPlainObject(value, AGENT_VIEW_FIELDS)) return false;
  return isValidUlid(value.agent_id) &&
    isBoundedNonBlankString(value.agent_no, 32) &&
    isBoundedNonBlankString(value.name, 120) &&
    (value.contact_name === null ||
      (typeof value.contact_name === 'string' && Array.from(value.contact_name).length <= 80)) &&
    (value.contact_phone_tail === null ||
      (typeof value.contact_phone_tail === 'string' && /^[0-9]{4}$/.test(value.contact_phone_tail))) &&
    typeof value.status === 'string' && AGENT_STATUS.has(value.status) &&
    typeof value.product_authorization_mode === 'string' &&
      AGENT_AUTHORIZATION_MODE.has(value.product_authorization_mode) &&
    isPositiveInteger(value.version);
}

function isCacheableAgentResourceResponse(value: unknown): value is CacheableAgentResourceResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  return isCacheableAgentView(value.data);
}

function isCacheableAgentProductAuthorizationResponse(
  value: unknown,
): value is CacheableAgentProductAuthorizationResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id)) ||
    !isExactPlainObject(value.data, AGENT_PRODUCT_AUTHORIZATION_FIELDS) ||
    !isValidUlid(value.data.agent_id) ||
    typeof value.data.mode !== 'string' || !AGENT_AUTHORIZATION_MODE.has(value.data.mode) ||
    !Array.isArray(value.data.product_ids) ||
    value.data.product_ids.some((productId) => typeof productId !== 'string' || !isValidUlid(productId)) ||
    new Set(value.data.product_ids).size !== value.data.product_ids.length ||
    !isPositiveInteger(value.data.version)) return false;
  return value.data.mode !== 'ALL_ACTIVE_PRODUCTS' || value.data.product_ids.length === 0;
}

function isCacheableAgentInviteRotateReplay(value: unknown): value is CacheableAgentInviteRotateReplay {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id)) ||
    !isExactPlainObject(value.data, AGENT_INVITE_ROTATE_FIELDS) ||
    !isValidUlid(value.data.agent_id) || value.data.new_invite_code !== null ||
    value.data.disclosure_state !== 'REPLAY_REDACTED' || value.data.reissue_required !== true ||
    !isExactPlainObject(value.data.old_code_invalidated, INVALIDATED_INVITE_FIELDS)) return false;
  const oldCode = value.data.old_code_invalidated;
  return isValidUlid(oldCode.invite_code_id) &&
    isBoundedNonBlankString(oldCode.code_masked, 128) &&
    typeof oldCode.invalidated_at === 'string' && ISO_TIMESTAMP.test(oldCode.invalidated_at) &&
    oldCode.existing_bindings_unchanged === true;
}

function isCacheableAttributionBindingView(
  value: unknown,
  customerId: string,
  customerVersion: number,
): value is CacheableAttributionBindingView {
  return isExactPlainObject(value, ATTRIBUTION_BINDING_VIEW_FIELDS) &&
    isValidUlid(value.binding_id) &&
    value.customer_id === customerId &&
    isValidUlid(value.agent_id) &&
    isBoundedNonBlankString(value.agent_name, 120) &&
    typeof value.started_at === 'string' && ISO_TIMESTAMP.test(value.started_at) &&
    value.customer_version === customerVersion;
}

function isCacheableAdminCustomerView(value: unknown): value is CacheableAdminCustomerView {
  if ((!isExactPlainObject(value, ADMIN_CUSTOMER_VIEW_FIELDS) &&
      !isExactPlainObject(value, ADMIN_CUSTOMER_VIEW_FIELDS_WITHOUT_CITY)) ||
    !isValidUlid(value.customer_id) ||
    !isBoundedNonBlankString(value.customer_alias, 80) ||
    typeof value.account_status !== 'string' || !CUSTOMER_ACCOUNT_STATUS.has(value.account_status) ||
    !isNullableBoundedString(value.nickname_masked, 80) ||
    !(value.phone_masked === null ||
      (typeof value.phone_masked === 'string' && MASKED_PHONE.test(value.phone_masked))) ||
    !(value.city === undefined || isNullableBoundedString(value.city, 120)) ||
    typeof value.consumption_amount !== 'string' || !NON_NEGATIVE_MONEY.test(value.consumption_amount) ||
    !isNonNegativeInteger(value.consumption_count) ||
    typeof value.registered_at !== 'string' || !ISO_TIMESTAMP.test(value.registered_at) ||
    !isNullableBoundedString(value.last_product_name, 200) ||
    !isNullableTimestamp(value.last_purchase_at) ||
    !(value.last_order_id === null ||
      (typeof value.last_order_id === 'string' && isValidUlid(value.last_order_id))) ||
    typeof value.management_note_present !== 'boolean' ||
    !(value.deletion_request_status === null ||
      (typeof value.deletion_request_status === 'string' &&
        CUSTOMER_DELETION_STATUS.has(value.deletion_request_status))) ||
    !isPositiveInteger(value.version)) return false;
  return value.binding === null ||
    isCacheableAttributionBindingView(value.binding, value.customer_id, value.version);
}

function isCacheableAdminCustomerResponse(value: unknown): value is CacheableAdminCustomerResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  return isCacheableAdminCustomerView(value.data);
}

function isCacheableSkuSpec(value: unknown): value is CacheableSkuSpec {
  if (!isExactPlainObject(value, SKU_SPEC_FIELDS) || !Array.isArray(value.attributes) ||
    value.attributes.length === 0) return false;
  const identities = new Set<string>();
  for (const attribute of value.attributes) {
    if (!isExactPlainObject(attribute, SKU_ATTRIBUTE_FIELDS) ||
      !isBoundedNonBlankString(attribute.name, 80) ||
      !isBoundedNonBlankString(attribute.value, 160)) return false;
    const identity = canonicalJson({ name: attribute.name, value: attribute.value });
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function isCacheableSkuView(value: unknown): value is CacheableSkuView {
  if (!isExactPlainObject(value, SKU_VIEW_FIELDS)) return false;
  return isValidUlid(value.sku_id) &&
    isBoundedNonBlankString(value.code, 80) &&
    isBoundedNonBlankString(value.name, 160) &&
    (value.spec_json === null || isCacheableSkuSpec(value.spec_json)) &&
    typeof value.retail_price === 'string' && POSITIVE_MONEY.test(value.retail_price) &&
    typeof value.is_recommended === 'boolean' &&
    typeof value.status === 'string' && SKU_STATUS.has(value.status) &&
    isNonNegativeInteger(value.available_stock) &&
    isPositiveInteger(value.version);
}

function isCacheableProductImageView(value: unknown): value is CacheableProductImageView {
  if (!isExactPlainObject(value, PRODUCT_IMAGE_VIEW_FIELDS)) return false;
  return isValidUlid(value.file_id) && isPublicFileUrl(value.url, value.file_id) &&
    isNonNegativeInteger(value.sort_order) && typeof value.is_primary === 'boolean';
}

function isCacheableProductDetailView(value: unknown): value is CacheableProductDetailView {
  if (!isExactPlainObject(value, PRODUCT_DETAIL_VIEW_FIELDS) ||
    !isValidUlid(value.product_id) ||
    !isBoundedNonBlankString(value.spu_code, 80) ||
    !isBoundedNonBlankString(value.name, 200) ||
    !isNullableBoundedString(value.subtitle, 300) ||
    !isNullableBoundedString(value.introduction, 5_000) ||
    !isNullableBoundedString(value.ingredients, 10_000) ||
    !isNullableBoundedString(value.usage_method, 5_000) ||
    !isCacheableBrandView(value.brand) ||
    !isCacheableCategoryView(value.category) ||
    !Array.isArray(value.images) || value.images.length > 8 ||
    !Array.isArray(value.skus) ||
    !isNonNegativeInteger(value.net_sales_count) ||
    typeof value.is_hot !== 'boolean' || typeof value.is_new !== 'boolean' ||
    typeof value.status !== 'string' || !CATALOG_STATUS.has(value.status) ||
    !isPositiveInteger(value.version)) return false;
  const fileIds = new Set<string>();
  const sortOrders = new Set<number>();
  for (const [index, image] of value.images.entries()) {
    if (!isCacheableProductImageView(image) || fileIds.has(image.file_id) ||
      sortOrders.has(image.sort_order) || image.is_primary !== (index === 0)) return false;
    fileIds.add(image.file_id);
    sortOrders.add(image.sort_order);
  }
  return value.skus.every((sku) => isCacheableSkuView(sku));
}

function isCacheableProductCatalogResponse(value: unknown): value is CacheableProductCatalogResponse {
  if (!isExactPlainObject(value, CATALOG_RESPONSE_TOP_LEVEL_FIELDS) || value.code !== 'OK' ||
    value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  return isCacheableProductDetailView(value.data) || isCacheableSkuView(value.data);
}

function isCacheableFileUploadCompleteResponse(
  value: unknown,
): value is CacheableFileUploadCompleteResponse {
  if (!isExactPlainObject(value, FILE_UPLOAD_COMPLETE_TOP_LEVEL_FIELDS)) return false;
  if (value.code !== 'OK' || value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  if (!isExactPlainObject(value.data, FILE_UPLOAD_COMPLETE_DATA_FIELDS)) return false;
  if (!isValidUlid(value.data.file_id) || value.data.status !== 'READY' ||
    typeof value.data.purpose !== 'string' || !FILE_PURPOSE.has(value.data.purpose as CacheableFilePurpose) ||
    typeof value.data.completed_at !== 'string' || !ISO_TIMESTAMP.test(value.data.completed_at)) {
    return false;
  }
  const purpose = value.data.purpose as CacheableFilePurpose;
  return PUBLIC_FILE_PURPOSE.has(purpose)
    ? isStablePublicUrl(value.data.public_url)
    : value.data.public_url === null;
}

function cacheableResourceId(
  response: CacheableCommandResponse | CacheableFileUploadCompleteResponse |
    CacheableCatalogResourceResponse | CacheableProductCatalogResponse | CacheableBannerResourceResponse |
    CacheableAgentResourceResponse | CacheableAgentProductAuthorizationResponse |
    CacheableAgentInviteRotateReplay | CacheableAdminCustomerResponse,
): string {
  if (isCacheableCommandResponse(response)) return response.data.resource_id;
  if (isCacheableFileUploadCompleteResponse(response)) return response.data.file_id;
  if (isCacheableBannerResourceResponse(response)) return response.data.banner_id;
  if (isCacheableAgentResourceResponse(response)) return response.data.agent_id;
  if (isCacheableAgentProductAuthorizationResponse(response)) return response.data.agent_id;
  if (isCacheableAgentInviteRotateReplay(response)) return response.data.agent_id;
  if (isCacheableAdminCustomerResponse(response)) return response.data.customer_id;
  if (isCacheableProductCatalogResponse(response)) {
    return 'product_id' in response.data ? response.data.product_id : response.data.sku_id;
  }
  return 'brand_id' in response.data ? response.data.brand_id : response.data.category_id;
}

function validateClaim(input: IdempotencyClaim): void {
  if (!isExactPlainObject(input, CLAIM_FIELDS)) {
    throw new TypeError('Idempotency claim contains unsupported fields');
  }
  if (!isValidUlid(input.actorId)) throw new TypeError('Idempotency actor ID must be a ULID');
  if (!UUID.test(input.idempotencyKey)) {
    throw new TypeError('Idempotency key must be a UUID');
  }
  if (!isExactPlainObject(input.request, REQUEST_DESCRIPTOR_FIELDS) ||
    !MUTATION_METHOD.has(input.request.method) ||
    !/^\/[^?#]{0,159}$/.test(input.request.route) ||
    typeof input.request.pathParameters !== 'object' || input.request.pathParameters === null ||
    Array.isArray(input.request.pathParameters) ||
    Object.values(input.request.pathParameters).some((value) => typeof value !== 'string')) {
    throw new TypeError('Idempotency request descriptor is invalid');
  }
}

function validateResult(result: IdempotencyResult): void {
  if (result.storage !== 'CACHEABLE' && result.storage !== 'HASH_ONLY') {
    throw new TypeError('Idempotency storage policy is invalid');
  }
  const fields = result.storage === 'CACHEABLE' ? CACHEABLE_RESULT_FIELDS : HASH_ONLY_RESULT_FIELDS;
  const expectedFields = new Set([...fields].filter((field) =>
    field !== 'resourceId' || (result.storage === 'HASH_ONLY' && result.resourceId !== undefined)));
  if (!isExactPlainObject(result, expectedFields)) {
    throw new TypeError('Idempotency result contains unsupported fields');
  }
  if (!Number.isInteger(result.responseStatus) || result.responseStatus < 100 || result.responseStatus > 599) {
    throw new TypeError('Idempotency response status is invalid');
  }
  if (result.storage === 'CACHEABLE' && (result.responseStatus < 200 || result.responseStatus > 299)) {
    throw new TypeError('CACHEABLE idempotency responses must use a successful HTTP status');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'FILE_UPLOAD_COMPLETE' &&
    result.responseStatus !== 200) {
    throw new TypeError('FILE_UPLOAD_COMPLETE responses must use HTTP status 200');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'CATALOG_RESOURCE_RESPONSE' &&
    result.responseStatus !== 200 && result.responseStatus !== 201) {
    throw new TypeError('CATALOG_RESOURCE_RESPONSE responses must use HTTP status 200 or 201');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'PRODUCT_CATALOG_RESPONSE' &&
    result.responseStatus !== 200 && result.responseStatus !== 201) {
    throw new TypeError('PRODUCT_CATALOG_RESPONSE responses must use HTTP status 200 or 201');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'BANNER_RESOURCE_RESPONSE' &&
    result.responseStatus !== 200 && result.responseStatus !== 201) {
    throw new TypeError('BANNER_RESOURCE_RESPONSE responses must use HTTP status 200 or 201');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'AGENT_RESOURCE_RESPONSE' &&
    result.responseStatus !== 200) {
    throw new TypeError('AGENT_RESOURCE_RESPONSE responses must use HTTP status 200');
  }
  if (result.storage === 'CACHEABLE' &&
    (result.policy === 'AGENT_PRODUCT_AUTHORIZATION_RESPONSE' ||
      result.policy === 'AGENT_INVITE_ROTATE_REPLAY') && result.responseStatus !== 200) {
    throw new TypeError(`${result.policy} responses must use HTTP status 200`);
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'ADMIN_CUSTOMER_RESPONSE' &&
    result.responseStatus !== 200) {
    throw new TypeError('ADMIN_CUSTOMER_RESPONSE responses must use HTTP status 200');
  }
  if (result.storage === 'CACHEABLE') {
    if (result.policy === 'COMMAND_RESPONSE') {
      if (!isCacheableCommandResponse(result.responseBody)) {
        throw new TypeError('Only a valid COMMAND_RESPONSE may use the COMMAND_RESPONSE cache policy');
      }
    } else if (result.policy === 'FILE_UPLOAD_COMPLETE') {
      if (!isCacheableFileUploadCompleteResponse(result.responseBody)) {
        throw new TypeError('Only a valid file completion response may use the FILE_UPLOAD_COMPLETE cache policy');
      }
    } else if (result.policy === 'CATALOG_RESOURCE_RESPONSE') {
      if (!isCacheableCatalogResourceResponse(result.responseBody)) {
        throw new TypeError('Only a valid catalog response may use the CATALOG_RESOURCE_RESPONSE cache policy');
      }
    } else if (result.policy === 'PRODUCT_CATALOG_RESPONSE') {
      if (!isCacheableProductCatalogResponse(result.responseBody)) {
        throw new TypeError(
          'Only a valid product catalog response may use the PRODUCT_CATALOG_RESPONSE cache policy',
        );
      }
    } else if (result.policy === 'BANNER_RESOURCE_RESPONSE') {
      if (!isCacheableBannerResourceResponse(result.responseBody)) {
        throw new TypeError('Only a valid banner response may use the BANNER_RESOURCE_RESPONSE cache policy');
      }
    } else if (result.policy === 'AGENT_RESOURCE_RESPONSE') {
      if (!isCacheableAgentResourceResponse(result.responseBody)) {
        throw new TypeError('Only a valid Agent response may use the AGENT_RESOURCE_RESPONSE cache policy');
      }
    } else if (result.policy === 'AGENT_PRODUCT_AUTHORIZATION_RESPONSE') {
      if (!isCacheableAgentProductAuthorizationResponse(result.responseBody)) {
        throw new TypeError('Only a valid authorization response may use the Agent authorization cache policy');
      }
    } else if (result.policy === 'AGENT_INVITE_ROTATE_REPLAY') {
      if (!isCacheableAgentInviteRotateReplay(result.responseBody)) {
        throw new TypeError('Only a redacted invite rotation may use the invite replay cache policy');
      }
    } else if (result.policy === 'ADMIN_CUSTOMER_RESPONSE') {
      if (!isCacheableAdminCustomerResponse(result.responseBody)) {
        throw new TypeError('Only a valid Admin customer response may use the Admin customer cache policy');
      }
    } else {
      throw new TypeError('CACHEABLE idempotency policy is not registered');
    }
  }
  if (result.storage === 'HASH_ONLY' && result.resourceId !== undefined && !isValidUlid(result.resourceId)) {
    throw new TypeError('Idempotency resource ID must be a ULID');
  }
}

export class IdempotencyRepository {
  private readonly currentHashKey: IdempotencyHashKey;
  private readonly activeHashKeys: readonly IdempotencyHashKey[];

  constructor(
    hashKeys: IdempotencyHashKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!hashKeys || typeof hashKeys !== 'object' || !hashKeys.current || !Array.isArray(hashKeys.previous)) {
      throw new TypeError('Idempotency HMAC key ring is invalid');
    }
    if (hashKeys.previous.length > MAX_PREVIOUS_HASH_KEYS) {
      throw new TypeError(`Idempotency HMAC key ring supports at most ${MAX_PREVIOUS_HASH_KEYS} previous keys`);
    }
    const activeHashKeys = [hashKeys.current, ...hashKeys.previous].map(({ id, key }) => {
      if (!HASH_KEY_ID.test(id)) throw new TypeError('Idempotency HMAC key ID is invalid');
      if (!(key instanceof Uint8Array) || key.byteLength < 32) {
        throw new TypeError('Idempotency HMAC keys must contain at least 32 bytes');
      }
      return { id, key: Buffer.from(key) };
    });
    if (new Set(activeHashKeys.map(({ id }) => id)).size !== activeHashKeys.length) {
      throw new TypeError('Idempotency HMAC key IDs must be unique');
    }
    if (activeHashKeys.some((entry, index) =>
      activeHashKeys.some((candidate, candidateIndex) =>
        index !== candidateIndex && entry.key.equals(candidate.key)))) {
      throw new TypeError('Idempotency HMAC keys must be unique');
    }
    this.currentHashKey = activeHashKeys[0] as IdempotencyHashKey;
    this.activeHashKeys = activeHashKeys;
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
  }

  private requestHash(input: IdempotencyClaim, hashKey = this.currentHashKey): string {
    return hmacCanonicalJson(
      { key_id: hashKey.id, request: input.request },
      hashKey.key,
      'idempotency-request',
    );
  }

  private requestHashMatches(input: IdempotencyClaim, storedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
    const stored = Buffer.from(storedHash, 'hex');
    let matched = false;
    for (const hashKey of this.activeHashKeys) {
      const candidate = Buffer.from(this.requestHash(input, hashKey), 'hex');
      matched = timingSafeEqual(stored, candidate) || matched;
    }
    return matched;
  }

  private responseHash(
    value: unknown,
    context: ResponseIntegrityContext,
    hashKey = this.currentHashKey,
  ): string {
    return hmacCanonicalJson(
      {
        actor_id: context.actorId,
        idempotency_key: context.idempotencyKey,
        key_id: hashKey.id,
        request_hash: context.requestHash,
        response: value,
        scope: context.scope,
      },
      hashKey.key,
      'idempotency-response',
    );
  }

  private responseHashMatches(
    value: unknown,
    context: ResponseIntegrityContext,
    storedHash: string | null,
  ): boolean {
    if (!storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
    const stored = Buffer.from(storedHash, 'hex');
    let matched = false;
    for (const hashKey of this.activeHashKeys) {
      const candidate = Buffer.from(this.responseHash(value, context, hashKey), 'hex');
      matched = timingSafeEqual(stored, candidate) || matched;
    }
    return matched;
  }

  private responseIntegrityContext(record: IdempotencyRecord): ResponseIntegrityContext | undefined {
    if (!isValidUlid(record.actor_id) || !UUID.test(record.idempotency_key) ||
      !IDEMPOTENCY_SCOPE.test(record.scope) || !/^[a-f0-9]{64}$/.test(record.request_hash)) {
      return undefined;
    }
    return {
      actorId: record.actor_id,
      idempotencyKey: record.idempotency_key,
      requestHash: record.request_hash,
      scope: record.scope,
    };
  }

  private assertReplayIntegrity(record: IdempotencyRecord): void {
    if (record.response_body === null) {
      if (!record.response_body_hash || !/^[a-f0-9]{64}$/.test(record.response_body_hash) ||
        (record.resource_id !== null && !isValidUlid(record.resource_id))) {
        throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record integrity check failed');
      }
      return;
    }
    const response = record.response_body;
    const integrityContext = this.responseIntegrityContext(record);
    const commandResponse = isCacheableCommandResponse(response);
    const fileCompleteResponse = isCacheableFileUploadCompleteResponse(response);
    const catalogResponse = isCacheableCatalogResourceResponse(response);
    const productCatalogResponse = isCacheableProductCatalogResponse(response);
    const bannerResponse = isCacheableBannerResourceResponse(response);
    const agentResponse = isCacheableAgentResourceResponse(response);
    const agentAuthorizationResponse = isCacheableAgentProductAuthorizationResponse(response);
    const inviteRotateReplay = isCacheableAgentInviteRotateReplay(response);
    const adminCustomerResponse = isCacheableAdminCustomerResponse(response);
    if (record.response_status < 200 || record.response_status > 299 ||
      (!commandResponse && !fileCompleteResponse && !catalogResponse && !productCatalogResponse && !bannerResponse &&
        !agentResponse && !agentAuthorizationResponse && !inviteRotateReplay && !adminCustomerResponse) ||
      (fileCompleteResponse && record.response_status !== 200) ||
      (catalogResponse && record.response_status !== 200 && record.response_status !== 201) ||
      (productCatalogResponse && record.response_status !== 200 && record.response_status !== 201) ||
      (bannerResponse && record.response_status !== 200 && record.response_status !== 201) ||
      (agentResponse && record.response_status !== 200) ||
      (agentAuthorizationResponse && record.response_status !== 200) ||
      (inviteRotateReplay && record.response_status !== 200) ||
      (adminCustomerResponse && record.response_status !== 200) ||
      integrityContext === undefined ||
      record.resource_id !== cacheableResourceId(response) ||
      !this.responseHashMatches(record.response_body, integrityContext, record.response_body_hash)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record integrity check failed');
    }
  }

  fileUploadCompleteReplay(record: IdempotencyRecord): CacheableFileUploadCompleteResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableFileUploadCompleteResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a file completion response');
    }
    return record.response_body;
  }

  commandReplay(record: IdempotencyRecord): CacheableCommandResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableCommandResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a command response');
    }
    return record.response_body;
  }

  assertHashOnlyReplay(
    record: IdempotencyRecord,
    result: Extract<IdempotencyResult, { storage: 'HASH_ONLY' }>,
  ): void {
    validateResult(result);
    this.assertReplayIntegrity(record);
    const integrityContext = this.responseIntegrityContext(record);
    if (record.response_body !== null ||
      record.response_status !== result.responseStatus ||
      record.resource_id !== (result.resourceId ?? null) ||
      integrityContext === undefined ||
      !this.responseHashMatches(result.responseForHash, integrityContext, record.response_body_hash)) {
      throw new ApplicationError('INTERNAL_ERROR', 'HASH_ONLY idempotency replay integrity check failed');
    }
  }

  catalogResourceReplay(record: IdempotencyRecord): CacheableCatalogResourceResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableCatalogResourceResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a catalog response');
    }
    return record.response_body;
  }

  productCatalogReplay(record: IdempotencyRecord): CacheableProductCatalogResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableProductCatalogResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a product catalog response');
    }
    return record.response_body;
  }

  bannerResourceReplay(record: IdempotencyRecord): CacheableBannerResourceResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableBannerResourceResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a banner response');
    }
    return record.response_body;
  }

  agentResourceReplay(record: IdempotencyRecord): CacheableAgentResourceResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableAgentResourceResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not an Agent response');
    }
    return record.response_body;
  }

  agentProductAuthorizationReplay(record: IdempotencyRecord): CacheableAgentProductAuthorizationResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableAgentProductAuthorizationResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not an Agent authorization response');
    }
    return record.response_body;
  }

  agentInviteRotateReplay(record: IdempotencyRecord): CacheableAgentInviteRotateReplay {
    this.assertReplayIntegrity(record);
    if (!isCacheableAgentInviteRotateReplay(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a redacted invite rotation');
    }
    return record.response_body;
  }

  adminCustomerReplay(record: IdempotencyRecord): CacheableAdminCustomerResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableAdminCustomerResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not an Admin customer response');
    }
    return record.response_body;
  }

  async assertKeyNotUsedForRequest(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    disallowedRequest: Pick<IdempotencyRequestDescriptor, 'method' | 'route'>,
  ): Promise<void> {
    validateClaim(claim);
    validateRequestScopeDescriptor(disallowedRequest);
    const claimScope = deriveIdempotencyScope(claim.request);
    const disallowedScope = deriveIdempotencyScope(disallowedRequest);
    if (claimScope === disallowedScope) {
      throw new TypeError('Idempotency request scopes must differ');
    }
    await acquireTransactionLock(
      transaction,
      'idempotency',
      [claim.actorId, disallowedScope, claim.idempotencyKey],
    );
    const record = await transaction.idempotencyRecord.findUnique({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: claim.actorId,
          scope: disallowedScope,
          idempotency_key: claim.idempotencyKey,
        },
      },
    });
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
    if (record && record.expires_at.getTime() > now.getTime()) {
      throw new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used in another request scope');
    }
  }

  async claim(transaction: DatabaseTransaction, input: IdempotencyClaim): Promise<IdempotencyClaimResult> {
    validateClaim(input);
    const scope = deriveIdempotencyScope(input.request);
    await acquireTransactionLock(transaction, 'idempotency', [input.actorId, scope, input.idempotencyKey]);
    const record = await transaction.idempotencyRecord.findUnique({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: input.actorId,
          scope,
          idempotency_key: input.idempotencyKey,
        },
      },
    });
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
    if (!record || record.expires_at.getTime() <= now.getTime()) return { kind: 'execute' };
    if (!this.requestHashMatches(input, record.request_hash)) {
      throw new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used for another request');
    }
    this.assertReplayIntegrity(record);
    return { kind: 'replay', record };
  }

  async complete(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    result: IdempotencyResult,
  ): Promise<IdempotencyRecord> {
    validateClaim(claim);
    const requestHash = this.requestHash(claim);
    validateResult(result);
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
    const scope = deriveIdempotencyScope(claim.request);
    const integrityContext: ResponseIntegrityContext = {
      actorId: claim.actorId,
      idempotencyKey: claim.idempotencyKey,
      requestHash,
      scope,
    };
    await acquireTransactionLock(transaction, 'idempotency', [claim.actorId, scope, claim.idempotencyKey]);
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: claim.actorId,
          scope,
          idempotency_key: claim.idempotencyKey,
        },
      },
    });
    if (existing && existing.expires_at.getTime() > now.getTime()) {
      if (!this.requestHashMatches(claim, existing.request_hash)) {
        throw new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used for another request');
      }
      this.assertReplayIntegrity(existing);
      return existing;
    }
    const responseBody = result.storage === 'CACHEABLE'
      ? result.responseBody as unknown as Prisma.InputJsonValue
      : undefined;
    const responseBodyHash = this.responseHash(
      result.storage === 'CACHEABLE' ? result.responseBody : result.responseForHash,
      integrityContext,
    );
    const data = {
      request_hash: requestHash,
      response_status: result.responseStatus,
      response_body: responseBody ?? Prisma.DbNull,
      response_body_hash: responseBodyHash,
      resource_id: result.storage === 'CACHEABLE'
        ? cacheableResourceId(result.responseBody)
        : result.resourceId ?? null,
      expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      created_at: now,
    };
    return transaction.idempotencyRecord.upsert({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: claim.actorId,
          scope,
          idempotency_key: claim.idempotencyKey,
        },
      },
      create: {
        id: generateUlid(now.getTime()),
        actor_id: claim.actorId,
        scope,
        idempotency_key: claim.idempotencyKey,
        ...data,
      },
      update: data,
    });
  }
}
