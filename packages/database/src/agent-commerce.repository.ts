import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { CommissionSourceType, ProductAuthorizationMode, PromotionTargetType } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import {
  buildFinalObjectKey,
  FILE_ASSET_MAX_BYTES,
  FileAssetRepository,
  type FileAssetSnapshot,
} from './file-asset.repository';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AgentCommerceIdentity {
  accountId: string;
  agentId: string;
}

export interface AgentProductListInput extends AgentCommerceIdentity {
  page: number;
  pageSize: number;
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  recommended?: boolean;
}

export interface AgentProductImageSnapshot {
  objectKey: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface AgentProductBrandSnapshot {
  id: string;
  name: string;
  description: string | null;
  logoObjectKey: string | null;
  sortOrder: number;
}

export interface AgentProductCategorySnapshot {
  id: string;
  name: string;
  iconObjectKey: string | null;
  sortOrder: number;
}

export interface AgentProductSkuSnapshot {
  id: string;
  code: string;
  name: string;
  specification: Prisma.JsonValue | null;
  retailPrice: string;
  isRecommended: boolean;
  currentEstimatedRate: string;
  ruleSource: CommissionSourceType;
  ruleVersionId: string;
  estimatedCommissionPerUnit: string;
}

export interface AgentProductSnapshot {
  id: string;
  spuCode: string;
  name: string;
  subtitle: string | null;
  brand: AgentProductBrandSnapshot;
  category: AgentProductCategorySnapshot;
  primaryImage: AgentProductImageSnapshot | null;
  images: AgentProductImageSnapshot[];
  skus: AgentProductSkuSnapshot[];
}

export interface AgentProductListResult {
  items: AgentProductSnapshot[];
  total: number;
}

export interface AgentProductDetailInput extends AgentCommerceIdentity {
  productId: string;
}

export interface AgentPromotionTargetInput extends AgentCommerceIdentity {
  targetType: PromotionTargetType;
  targetProductId: string | null;
}

export interface AgentPromotionCreationContext extends AgentPromotionTargetInput {
  authorizationVersion: number;
  inviteCode: {
    id: string;
    ciphertext: Uint8Array;
    encryptionKeyId: string;
    expiresAt: Date | null;
  };
}

export interface CreateAgentPromotionAssetInput extends AgentPromotionTargetInput {
  promotionAssetId: string;
  inviteCodeId: string;
  publicUrl: string;
  qrFile: {
    fileId: string;
    byteSize: bigint;
    sha256: string;
  };
}

export interface AgentPromotionAssetSnapshot {
  id: string;
  agentId: string;
  inviteCodeId: string;
  targetType: PromotionTargetType;
  targetProductId: string | null;
  publicUrl: string;
  authorizationVersion: number;
  expiresAt: Date | null;
  attributionEligible: true;
  inviteCode: {
    id: string;
    ciphertext: Uint8Array;
    encryptionKeyId: string;
  };
  qrFile: FileAssetSnapshot;
  createdAt: Date;
}

export interface AgentPromotionAssetInput extends AgentCommerceIdentity {
  promotionAssetId: string;
}

export interface AgentPromotionQrDownloadInput extends AgentCommerceIdentity {
  fileId: string;
}

export interface AgentPromotionQrFileSnapshot {
  id: string;
  objectKey: string;
  byteSize: bigint;
  mimeType: 'image/png';
  sha256: string;
  status: 'READY';
  visibility: 'PRIVATE';
  purpose: 'PROMOTION_QR';
}

const PUBLIC_FILE_SELECT = {
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
} as const;

const AGENT_SELECT = {
  account: {
    select: { deleted_at: true, id: true, role: true, status: true },
  },
  account_id: true,
  deleted_at: true,
  id: true,
  product_authorization_mode: true,
  status: true,
  version: true,
} satisfies Prisma.AgentProfileSelect;

const PRODUCT_SELECT = {
  brand: {
    select: {
      deleted_at: true,
      description: true,
      id: true,
      logo: { select: PUBLIC_FILE_SELECT },
      name: true,
      sort_order: true,
      status: true,
    },
  },
  category: {
    select: {
      deleted_at: true,
      icon: { select: PUBLIC_FILE_SELECT },
      id: true,
      name: true,
      sort_order: true,
      status: true,
    },
  },
  deleted_at: true,
  id: true,
  images: {
    orderBy: [{ sort_order: 'asc' as const }, { id: 'asc' as const }],
    select: {
      deleted_at: true,
      file: { select: PUBLIC_FILE_SELECT },
      file_id: true,
      id: true,
      sort_order: true,
    },
    where: { deleted_at: null },
  },
  name: true,
  published_at: true,
  skus: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: {
      code: true,
      deleted_at: true,
      id: true,
      is_recommended: true,
      name: true,
      retail_price: true,
      spec_json: true,
      status: true,
    },
    where: { deleted_at: null, status: 'ACTIVE' as const },
  },
  spu_code: true,
  status: true,
  subtitle: true,
} satisfies Prisma.ProductSelect;

const RULE_INCLUDE = {
  entries: { orderBy: [{ target_key: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CommissionRuleVersionInclude;

type AgentRecord = Prisma.AgentProfileGetPayload<{ select: typeof AGENT_SELECT }>;
type ProductRecord = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type RuleVersionRecord = Prisma.CommissionRuleVersionGetPayload<{ include: typeof RULE_INCLUDE }>;
type PublicFileRecord = NonNullable<ProductRecord['brand']['logo']>;

const LIST_FIELDS = new Set([
  'accountId',
  'agentId',
  'brandId',
  'categoryId',
  'keyword',
  'page',
  'pageSize',
  'recommended',
]);
const DETAIL_FIELDS = new Set(['accountId', 'agentId', 'productId']);
const TARGET_FIELDS = new Set(['accountId', 'agentId', 'targetProductId', 'targetType']);
const CREATE_PROMOTION_FIELDS = new Set([
  'accountId',
  'agentId',
  'inviteCodeId',
  'promotionAssetId',
  'publicUrl',
  'qrFile',
  'targetProductId',
  'targetType',
]);
const QR_FILE_FIELDS = new Set(['byteSize', 'fileId', 'sha256']);
const DOWNLOAD_FIELDS = new Set(['accountId', 'agentId', 'fileId']);
const PROMOTION_ASSET_FIELDS = new Set(['accountId', 'agentId', 'promotionAssetId']);
const SHA256 = /^[a-f0-9]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactFields(value: unknown, fields: ReadonlySet<string>, label: string): void {
  if (!isPlainObject(value) || Object.keys(value).length !== fields.size ||
    Object.keys(value).some((field) => !fields.has(field))) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function validateIdentity(input: AgentCommerceIdentity): void {
  requireUlid(input.accountId, 'Agent account ID');
  requireUlid(input.agentId, 'Agent ID');
  if (input.accountId === input.agentId) throw new TypeError('Agent and account IDs must differ');
}

function validateListInput(input: AgentProductListInput): void {
  if (!isPlainObject(input) || Object.keys(input).some((field) => !LIST_FIELDS.has(field))) {
    throw new TypeError('Agent product list input contains unsupported fields');
  }
  validateIdentity(input);
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (!Number.isSafeInteger((input.page - 1) * input.pageSize)) {
    throw new TypeError('Agent product list offset is outside the supported range');
  }
  if (input.keyword !== undefined) {
    if (typeof input.keyword !== 'string' || input.keyword.trim() !== input.keyword ||
      Array.from(input.keyword).length < 1 || Array.from(input.keyword).length > 200) {
      throw new TypeError('Agent product keyword is invalid');
    }
  }
  if (input.brandId !== undefined) requireUlid(input.brandId, 'Agent product Brand ID');
  if (input.categoryId !== undefined) requireUlid(input.categoryId, 'Agent product Category ID');
  if (input.recommended !== undefined && typeof input.recommended !== 'boolean') {
    throw new TypeError('Agent product recommended filter must be a boolean');
  }
}

function validateDetailInput(input: AgentProductDetailInput): void {
  requireExactFields(input, DETAIL_FIELDS, 'Agent product detail input');
  validateIdentity(input);
  requireUlid(input.productId, 'Agent Product ID');
}

function validateTarget(input: AgentPromotionTargetInput): void {
  requireExactFields(input, TARGET_FIELDS, 'Agent promotion target input');
  validateIdentity(input);
  if (input.targetType === 'STOREFRONT') {
    if (input.targetProductId !== null) throw new TypeError('Storefront promotion must not contain a Product ID');
  } else if (input.targetType === 'PRODUCT') {
    if (input.targetProductId === null) throw new TypeError('Product promotion requires a Product ID');
    requireUlid(input.targetProductId, 'Promotion Product ID');
  } else {
    throw new TypeError('Promotion target type is invalid');
  }
}

function validatePublicUrl(value: string): void {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > 500) {
    throw new TypeError('Promotion public URL is invalid');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Promotion public URL is invalid');
  }
  const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) || url.username || url.password) {
    throw new TypeError('Promotion public URL is invalid');
  }
}

function validateCreatePromotionInput(input: CreateAgentPromotionAssetInput): void {
  requireExactFields(input, CREATE_PROMOTION_FIELDS, 'Create Agent promotion input');
  validateTarget({
    accountId: input.accountId,
    agentId: input.agentId,
    targetProductId: input.targetProductId,
    targetType: input.targetType,
  });
  requireUlid(input.promotionAssetId, 'Promotion asset ID');
  requireUlid(input.inviteCodeId, 'Promotion invite-code ID');
  if (input.promotionAssetId === input.qrFile?.fileId) {
    throw new TypeError('Promotion asset and QR file IDs must differ');
  }
  validatePublicUrl(input.publicUrl);
  requireExactFields(input.qrFile, QR_FILE_FIELDS, 'Promotion QR file input');
  requireUlid(input.qrFile.fileId, 'Promotion QR file ID');
  if (typeof input.qrFile.byteSize !== 'bigint' || input.qrFile.byteSize < 1n ||
    input.qrFile.byteSize > FILE_ASSET_MAX_BYTES) {
    throw new TypeError('Promotion QR byte size is outside the supported range');
  }
  if (typeof input.qrFile.sha256 !== 'string' || !SHA256.test(input.qrFile.sha256)) {
    throw new TypeError('Promotion QR SHA-256 is invalid');
  }
}

function validateDownloadInput(input: AgentPromotionQrDownloadInput): void {
  requireExactFields(input, DOWNLOAD_FIELDS, 'Agent promotion QR download input');
  validateIdentity(input);
  requireUlid(input.fileId, 'Promotion QR file ID');
}

function validatePromotionAssetInput(input: AgentPromotionAssetInput): void {
  requireExactFields(input, PROMOTION_ASSET_FIELDS, 'Agent promotion asset input');
  validateIdentity(input);
  requireUlid(input.promotionAssetId, 'Promotion asset ID');
}

function currentTime(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Agent commerce repository clock must return a valid Date');
  }
  return new Date(value);
}

function notFound(message = 'Agent commerce resource does not exist'): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function activeAgent(record: AgentRecord | null, identity: AgentCommerceIdentity): AgentRecord {
  if (!record || record.id !== identity.agentId || record.account_id !== identity.accountId ||
    record.deleted_at !== null || record.status !== 'ACTIVE' || record.version < 1 ||
    record.account.id !== identity.accountId || record.account.deleted_at !== null ||
    record.account.role !== 'AGENT_ADMIN' || record.account.status !== 'ACTIVE') {
    throw notFound('Active Agent does not exist');
  }
  return record;
}

function activeProductWhere(
  agentId: string,
  authorizationMode: ProductAuthorizationMode,
  filters: Pick<AgentProductListInput, 'brandId' | 'categoryId' | 'keyword' | 'recommended'> = {},
): Prisma.ProductWhereInput {
  const activeSku: Prisma.SkuWhereInput = { deleted_at: null, status: 'ACTIVE' };
  const and: Prisma.ProductWhereInput[] = [{ skus: { some: activeSku } }];
  if (filters.recommended !== undefined) {
    and.push({
      skus: filters.recommended
        ? { some: { ...activeSku, is_recommended: true } }
        : { none: { ...activeSku, is_recommended: true } },
    });
  }
  return {
    AND: and,
    brand: { is: { deleted_at: null, status: 'ACTIVE' } },
    category: { is: { deleted_at: null, status: 'ACTIVE' } },
    deleted_at: null,
    status: 'ACTIVE',
    ...(authorizationMode === 'CUSTOM_WHITELIST'
      ? { whitelist_entries: { some: { agent_id: agentId, deleted_at: null } } }
      : {}),
    ...(filters.brandId === undefined ? {} : { brand_id: filters.brandId }),
    ...(filters.categoryId === undefined ? {} : { category_id: filters.categoryId }),
    ...(filters.keyword === undefined ? {} : {
      OR: [
        { name: { contains: filters.keyword, mode: 'insensitive' } },
        { spu_code: { contains: filters.keyword, mode: 'insensitive' } },
        { skus: { some: { ...activeSku, code: { contains: filters.keyword, mode: 'insensitive' } } } },
      ],
    }),
  };
}

function validPublicObjectKey(file: PublicFileRecord | null, purpose: string): string | null {
  if (!file || file.deleted_at !== null || file.object_key !== `public/${file.id}` ||
    file.purpose !== purpose || file.status !== 'READY' || file.visibility !== 'PUBLIC') return null;
  return file.object_key;
}

function safeRuleVersion(record: RuleVersionRecord | undefined, now: Date): RuleVersionRecord {
  if (!record || record.status !== 'PUBLISHED' || record.effective_at === null ||
    record.effective_at.getTime() > now.getTime() || !isValidUlid(record.id) ||
    !Number.isSafeInteger(record.version_no) || record.version_no < 1) {
    throw stateConflict('Current commission rule is unavailable');
  }
  return record;
}

function ruleEntries(record: RuleVersionRecord): Map<string, RuleVersionRecord['entries'][number]> {
  const entries = new Map<string, RuleVersionRecord['entries'][number]>();
  for (const entry of record.entries) {
    const validTarget = entry.target_type === 'PLATFORM'
      ? entry.target_id === null && entry.target_key === 'PLATFORM'
      : entry.target_id !== null && entry.target_key === `${entry.target_type}:${entry.target_id}`;
    if (!validTarget || !entry.configured_rate.isFinite() || entry.configured_rate.isNegative() ||
      entry.configured_rate.greaterThan(100) || entry.configured_rate.decimalPlaces() > 4 ||
      entries.has(entry.target_key)) {
      throw stateConflict('Current commission rule is unavailable');
    }
    entries.set(entry.target_key, entry);
  }
  const platform = entries.get('PLATFORM');
  if (!platform || platform.target_type !== 'PLATFORM' || platform.target_id !== null) {
    throw stateConflict('Current commission rule is unavailable');
  }
  return entries;
}

function productSnapshot(
  product: ProductRecord,
  ruleVersion: RuleVersionRecord,
  entries: ReadonlyMap<string, RuleVersionRecord['entries'][number]>,
): AgentProductSnapshot {
  if (product.deleted_at !== null || product.status !== 'ACTIVE' || product.brand.deleted_at !== null ||
    product.brand.status !== 'ACTIVE' || product.category.deleted_at !== null ||
    product.category.status !== 'ACTIVE' || product.skus.length === 0) {
    throw internalError('Agent product changed within a read snapshot');
  }
  const images: AgentProductImageSnapshot[] = [];
  for (const image of product.images) {
    const objectKey = validPublicObjectKey(image.file, 'PRODUCT_IMAGE');
    if (image.deleted_at !== null || objectKey === null) continue;
    images.push({ isPrimary: images.length === 0, objectKey, sortOrder: image.sort_order });
  }
  const skus = product.skus.map((sku): AgentProductSkuSnapshot => {
    const entry = entries.get(`SKU:${sku.id}`) ?? entries.get(`CATEGORY:${product.category.id}`) ??
      entries.get('PLATFORM');
    if (!entry || !sku.retail_price.isFinite() || !sku.retail_price.greaterThan(0) ||
      sku.retail_price.decimalPlaces() > 2) {
      throw stateConflict('Current commission rule is unavailable');
    }
    const commission = sku.retail_price.mul(entry.configured_rate).div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return {
      code: sku.code,
      currentEstimatedRate: entry.configured_rate.toFixed(4),
      estimatedCommissionPerUnit: commission.toFixed(2),
      id: sku.id,
      isRecommended: sku.is_recommended,
      name: sku.name,
      retailPrice: sku.retail_price.toFixed(2),
      ruleSource: entry.target_type,
      ruleVersionId: ruleVersion.id,
      specification: sku.spec_json,
    };
  });
  return {
    brand: {
      description: product.brand.description,
      id: product.brand.id,
      logoObjectKey: validPublicObjectKey(product.brand.logo, 'BRAND_LOGO'),
      name: product.brand.name,
      sortOrder: product.brand.sort_order,
    },
    category: {
      iconObjectKey: validPublicObjectKey(product.category.icon, 'CATEGORY_ICON'),
      id: product.category.id,
      name: product.category.name,
      sortOrder: product.category.sort_order,
    },
    id: product.id,
    images,
    name: product.name,
    primaryImage: images[0] ?? null,
    skus,
    spuCode: product.spu_code,
    subtitle: product.subtitle,
  };
}

export class AgentCommerceRepository {
  private readonly files: FileAssetRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentTime(this.now);
    this.files = new FileAssetRepository(prisma, now);
  }

  private async readActiveAgent(
    client: Pick<PrismaClient, 'agentProfile'>,
    identity: AgentCommerceIdentity,
  ): Promise<AgentRecord> {
    validateIdentity(identity);
    const record = await client.agentProfile.findUnique({
      select: AGENT_SELECT,
      where: { id: identity.agentId },
    });
    return activeAgent(record, identity);
  }

  private async lockActiveAgent(
    transaction: DatabaseTransaction,
    identity: AgentCommerceIdentity,
  ): Promise<AgentRecord> {
    validateIdentity(identity);
    await acquireTransactionLock(transaction, 'store-attribution-agent', [identity.agentId]);
    const profileRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.agent_profile WHERE id = ${identity.agentId} FOR UPDATE
    `);
    if (profileRows.length !== 1 || profileRows[0]?.id !== identity.agentId) throw notFound();
    await this.readActiveAgent(transaction, identity);
    await acquireTransactionLock(transaction, 'agent-auth-account', [identity.accountId]);
    const accountRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.account WHERE id = ${identity.accountId} FOR UPDATE
    `);
    if (accountRows.length !== 1 || accountRows[0]?.id !== identity.accountId) throw notFound();
    return this.readActiveAgent(transaction, identity);
  }

  private async currentInvite(transaction: DatabaseTransaction, agentId: string, now: Date) {
    const invites = await transaction.agentInviteCode.findMany({
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        agent_id: true,
        code_ciphertext: true,
        effective_at: true,
        encryption_key_id: true,
        ended_at: true,
        expires_at: true,
        id: true,
        status: true,
      },
      take: 2,
      where: {
        agent_id: agentId,
        effective_at: { lte: now },
        ended_at: null,
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        status: 'ACTIVE',
      },
    });
    if (invites.length !== 1) throw stateConflict('Agent requires one current active invite code');
    return invites[0]!;
  }

  private async currentRule(transaction: DatabaseTransaction, now: Date): Promise<RuleVersionRecord> {
    const versions = await transaction.commissionRuleVersion.findMany({
      include: RULE_INCLUDE,
      orderBy: [{ effective_at: 'desc' }, { id: 'desc' }],
      take: 2,
      where: { effective_at: { lte: now }, status: 'PUBLISHED' },
    });
    if (versions.length !== 1) throw stateConflict('Current commission rule is unavailable');
    return safeRuleVersion(versions[0], now);
  }

  async listAuthorizedProducts(input: AgentProductListInput): Promise<AgentProductListResult> {
    validateListInput(input);
    return this.prisma.$transaction(async (transaction) => {
      const agent = await this.readActiveAgent(transaction, input);
      const where = activeProductWhere(agent.id, agent.product_authorization_mode, input);
      const now = currentTime(this.now);
      const [products, total, ruleVersion] = await Promise.all([
        transaction.product.findMany({
          orderBy: [{ published_at: { nulls: 'last', sort: 'desc' } }, { id: 'desc' }],
          select: PRODUCT_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.product.count({ where }),
        this.currentRule(transaction, now),
      ]);
      if (!Number.isSafeInteger(total) || total < 0) throw internalError('Agent product count is invalid');
      const entries = ruleEntries(ruleVersion);
      return { items: products.map((product) => productSnapshot(product, ruleVersion, entries)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getAuthorizedProduct(input: AgentProductDetailInput): Promise<AgentProductSnapshot> {
    validateDetailInput(input);
    return this.prisma.$transaction(async (transaction) => {
      const agent = await this.readActiveAgent(transaction, input);
      const [product, ruleVersion] = await Promise.all([
        transaction.product.findFirst({
          select: PRODUCT_SELECT,
          where: {
            ...activeProductWhere(agent.id, agent.product_authorization_mode),
            id: input.productId,
          },
        }),
        this.currentRule(transaction, currentTime(this.now)),
      ]);
      if (!product) throw notFound('Authorized Agent product does not exist');
      return productSnapshot(product, ruleVersion, ruleEntries(ruleVersion));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getPromotionCreationContext(
    input: AgentPromotionTargetInput,
  ): Promise<AgentPromotionCreationContext> {
    validateTarget(input);
    return this.prisma.$transaction(async (transaction) => {
      const agent = await this.readActiveAgent(transaction, input);
      const now = currentTime(this.now);
      const invite = await this.currentInvite(transaction, agent.id, now);
      if (input.targetProductId !== null) {
        const product = await transaction.product.findFirst({
          select: { id: true },
          where: {
            ...activeProductWhere(agent.id, agent.product_authorization_mode),
            id: input.targetProductId,
          },
        });
        if (!product) throw notFound('Authorized Agent product does not exist');
      }
      return {
        accountId: input.accountId,
        agentId: agent.id,
        authorizationVersion: agent.version,
        inviteCode: {
          ciphertext: Uint8Array.from(invite.code_ciphertext),
          encryptionKeyId: invite.encryption_key_id,
          expiresAt: invite.expires_at,
          id: invite.id,
        },
        targetProductId: input.targetProductId,
        targetType: input.targetType,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async createPromotionAssetInTransaction(
    transaction: DatabaseTransaction,
    input: CreateAgentPromotionAssetInput,
  ): Promise<AgentPromotionAssetSnapshot> {
    validateCreatePromotionInput(input);
    const occurredAt = currentTime(this.now);
    const identity = { accountId: input.accountId, agentId: input.agentId };
    const agent = await this.lockActiveAgent(transaction, identity);
    const initialInvite = await this.currentInvite(transaction, agent.id, occurredAt);
    if (initialInvite.id !== input.inviteCodeId) {
      throw stateConflict('Agent invite code changed while promotion material was generated');
    }
    await acquireTransactionLock(transaction, 'store-attribution-invite', [input.inviteCodeId]);
    await acquireTransactionLock(transaction, 'store-attribution-promotion', [input.promotionAssetId]);
    const inviteRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.agent_invite_code WHERE id = ${input.inviteCodeId} FOR UPDATE
    `);
    if (inviteRows.length !== 1 || inviteRows[0]?.id !== input.inviteCodeId) throw stateConflict('Invite code changed');
    const invite = await this.currentInvite(transaction, agent.id, occurredAt);
    if (invite.id !== input.inviteCodeId) {
      throw stateConflict('Agent invite code changed while promotion material was generated');
    }

    if (input.targetProductId !== null) {
      await acquireTransactionLock(transaction, 'store-attribution-product', [input.targetProductId]);
      const productRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM public.product WHERE id = ${input.targetProductId} FOR UPDATE
      `);
      if (productRows.length !== 1 || productRows[0]?.id !== input.targetProductId) {
        throw notFound('Authorized Agent product does not exist');
      }
      const product = await transaction.product.findFirst({
        select: { id: true },
        where: {
          ...activeProductWhere(agent.id, agent.product_authorization_mode),
          id: input.targetProductId,
        },
      });
      if (!product) throw notFound('Authorized Agent product does not exist');
    }

    const completed = await this.files.markReadyInTransaction(transaction, {
      actorId: input.accountId,
      expectedByteSize: input.qrFile.byteSize,
      expectedSha256: input.qrFile.sha256,
      fileId: input.qrFile.fileId,
      measuredByteSize: input.qrFile.byteSize,
      measuredMimeType: 'image/png',
      measuredSha256: input.qrFile.sha256,
    });
    if (completed.asset.status !== 'READY' || completed.asset.visibility !== 'PRIVATE' ||
      completed.asset.purpose !== 'PROMOTION_QR' ||
      completed.asset.objectKey !== buildFinalObjectKey(input.qrFile.fileId, 'PROMOTION_QR')) {
      throw internalError('Promotion QR file lifecycle is inconsistent');
    }
    const created = await transaction.promotionAsset.create({
      data: {
        agent_id: agent.id,
        authorization_version: agent.version,
        created_at: occurredAt,
        expires_at: invite.expires_at,
        id: input.promotionAssetId,
        invite_code_id: invite.id,
        public_url: input.publicUrl,
        qr_file_id: completed.asset.id,
        revoked_at: null,
        status: 'ACTIVE',
        target_product_id: input.targetProductId,
        target_type: input.targetType,
      },
    });
    return {
      agentId: created.agent_id,
      attributionEligible: true,
      authorizationVersion: created.authorization_version,
      createdAt: created.created_at,
      expiresAt: created.expires_at,
      id: created.id,
      inviteCode: {
        ciphertext: Uint8Array.from(invite.code_ciphertext),
        encryptionKeyId: invite.encryption_key_id,
        id: invite.id,
      },
      inviteCodeId: created.invite_code_id,
      publicUrl: created.public_url,
      qrFile: completed.asset,
      targetProductId: created.target_product_id,
      targetType: created.target_type,
    };
  }

  async getPromotionAsset(input: AgentPromotionAssetInput): Promise<AgentPromotionAssetSnapshot> {
    validatePromotionAssetInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.readActiveAgent(transaction, input);
      const asset = await transaction.promotionAsset.findFirst({
        include: { invite_code: true, qr_file: true },
        where: { agent_id: input.agentId, id: input.promotionAssetId },
      });
      const file = asset?.qr_file;
      if (!asset || asset.invite_code.agent_id !== input.agentId || !file || file.deleted_at !== null ||
        file.created_by_id !== input.accountId || file.mime_type !== 'image/png' ||
        file.object_key !== buildFinalObjectKey(file.id, 'PROMOTION_QR') || file.purpose !== 'PROMOTION_QR' ||
        file.status !== 'READY' || file.visibility !== 'PRIVATE') {
        throw notFound('Promotion asset does not exist');
      }
      return {
        agentId: asset.agent_id,
        attributionEligible: true,
        authorizationVersion: asset.authorization_version,
        createdAt: asset.created_at,
        expiresAt: asset.expires_at,
        id: asset.id,
        inviteCode: {
          ciphertext: Uint8Array.from(asset.invite_code.code_ciphertext),
          encryptionKeyId: asset.invite_code.encryption_key_id,
          id: asset.invite_code.id,
        },
        inviteCodeId: asset.invite_code_id,
        publicUrl: asset.public_url,
        qrFile: {
          byteSize: file.byte_size,
          createdAt: file.created_at,
          createdById: file.created_by_id,
          deletedAt: file.deleted_at,
          id: file.id,
          mimeType: 'image/png',
          objectKey: file.object_key,
          originalName: file.original_name,
          purpose: 'PROMOTION_QR',
          sha256: file.sha256,
          status: 'READY',
          visibility: 'PRIVATE',
        },
        targetProductId: asset.target_product_id,
        targetType: asset.target_type,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getAgentPromotionQrDownloadable(
    input: AgentPromotionQrDownloadInput,
  ): Promise<AgentPromotionQrFileSnapshot> {
    validateDownloadInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.readActiveAgent(transaction, input);
      const file = await transaction.fileAsset.findFirst({
        select: {
          byte_size: true,
          id: true,
          mime_type: true,
          object_key: true,
          purpose: true,
          sha256: true,
          status: true,
          visibility: true,
        },
        where: {
          created_by_id: input.accountId,
          deleted_at: null,
          id: input.fileId,
          object_key: buildFinalObjectKey(input.fileId, 'PROMOTION_QR'),
          promotion_qr_files: { some: { agent_id: input.agentId } },
          purpose: 'PROMOTION_QR',
          status: 'READY',
          visibility: 'PRIVATE',
        },
      });
      if (!file || file.mime_type !== 'image/png') throw notFound('Promotion QR file does not exist');
      return {
        byteSize: file.byte_size,
        id: file.id,
        mimeType: 'image/png',
        objectKey: file.object_key,
        purpose: 'PROMOTION_QR',
        sha256: file.sha256,
        status: 'READY',
        visibility: 'PRIVATE',
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
