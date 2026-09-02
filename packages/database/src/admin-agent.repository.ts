import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { AgentStatus, ProductAuthorizationMode } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AdminAgentListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: AgentStatus;
  authorizationMode?: ProductAuthorizationMode;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
}

export interface AdminAgentSnapshot {
  id: string;
  accountId: string;
  agentNo: string;
  name: string;
  contactName: string | null;
  contactPhoneTail: string | null;
  status: AgentStatus;
  productAuthorizationMode: ProductAuthorizationMode;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  loginName: string;
  accountAlias: string;
  accountStatus: 'ACTIVE' | 'DISABLED';
  accountVersion: number;
}

export interface AdminAgentListItem extends AdminAgentSnapshot {
  activeCustomerCount: number;
  netSalesAmount: string;
  availableBalance: string;
}

export interface AdminAgentListResult {
  items: AdminAgentListItem[];
  total: number;
}

export interface AdminAgentInviteSnapshot {
  id: string;
  codeMasked: string;
  status: 'ACTIVE' | 'DISABLED' | 'ROTATED' | 'EXPIRED';
  expiresAt: Date | null;
  version: number;
}

export interface AdminAgentDetail {
  agent: AdminAgentSnapshot;
  inviteCode: AdminAgentInviteSnapshot | null;
  operatingSummary: {
    netSalesAmount: string;
    paidOrderCount: number;
    activeCustomerCount: number;
    newBindingCount: number;
  };
  walletSummary: {
    expectedCommission: string;
    availableBalance: string;
    frozenBalance: string;
    negativeBalance: string;
    version: number;
  };
  withdrawalSummary: {
    pendingCount: number;
    approvedCount: number;
    paidCount: number;
    totalPaidAmount: string;
    latestWithdrawalAt: Date | null;
  };
}

export interface AdminAgentContactPhoneMaterial {
  ciphertext: Uint8Array;
  last4: string;
  encryptionKeyId: string;
}

export interface AdminAgentInviteMaterial {
  codeHash: string;
  ciphertext: Uint8Array;
  last4: string;
  encryptionKeyId: string;
  expiresAt: Date | null;
}

export interface CreateAdminAgentInput {
  accountId: string;
  agentId: string;
  walletId: string;
  inviteCodeId: string;
  agentNo: string;
  loginName: string;
  passwordHash: string;
  name: string;
  contactName: string | null;
  contactPhone: AdminAgentContactPhoneMaterial | null;
  productAuthorizationMode: ProductAuthorizationMode;
  inviteCode: AdminAgentInviteMaterial;
}

export interface CreateAdminAgentResult {
  agent: AdminAgentSnapshot;
  initialInviteCode: AdminAgentInviteSnapshot;
}

export interface UpdateAdminAgentPatch {
  name?: string;
  contactName?: string | null;
  contactPhone?: AdminAgentContactPhoneMaterial | null;
}

export interface UpdateAdminAgentInput {
  agentId: string;
  expectedVersion: number;
  patch: UpdateAdminAgentPatch;
}

export interface AdminAgentDisableImpact {
  agent: AdminAgentSnapshot;
  activeSessionCount: number;
  activeInviteCount: number;
  activeCandidateCount: number;
  pendingPaymentOrderCount: number;
}

export interface AdminAgentPasswordResetImpact {
  agent: AdminAgentSnapshot;
  activeSessionCount: number;
}

export interface AdminAgentLifecycleInput {
  agentId: string;
  expectedVersion: number;
}

export interface ResetAdminAgentPasswordInput extends AdminAgentLifecycleInput {
  passwordHash: string;
}

export interface AdminAgentLifecycleResult {
  agent: AdminAgentSnapshot;
  accountVersion: number;
  revokedSessionCount: number;
  occurredAt: Date;
}

const AGENT_LIST_INCLUDE = {
  account: {
    select: {
      deleted_at: true,
      id: true,
      login_name: true,
      role: true,
      status: true,
      version: true,
    },
  },
  wallet: true,
} satisfies Prisma.AgentProfileInclude;

const AGENT_DETAIL_INCLUDE = {
  ...AGENT_LIST_INCLUDE,
  invite_codes: {
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} satisfies Prisma.AgentProfileInclude;

type AgentListRecord = Prisma.AgentProfileGetPayload<{ include: typeof AGENT_LIST_INCLUDE }>;
type AgentDetailRecord = Prisma.AgentProfileGetPayload<{ include: typeof AGENT_DETAIL_INCLUDE }>;
type AgentRecord = AgentListRecord | AgentDetailRecord;

const LIST_FIELDS = new Set([
  'authorizationMode',
  'createdAtFrom',
  'createdAtToExclusive',
  'keyword',
  'page',
  'pageSize',
  'status',
]);
const CREATE_FIELDS = new Set([
  'accountId',
  'agentId',
  'agentNo',
  'contactName',
  'contactPhone',
  'inviteCode',
  'inviteCodeId',
  'loginName',
  'name',
  'passwordHash',
  'productAuthorizationMode',
  'walletId',
]);
const CONTACT_FIELDS = new Set(['ciphertext', 'encryptionKeyId', 'last4']);
const INVITE_FIELDS = new Set(['ciphertext', 'codeHash', 'encryptionKeyId', 'expiresAt', 'last4']);
const UPDATE_FIELDS = new Set(['agentId', 'expectedVersion', 'patch']);
const UPDATE_PATCH_FIELDS = new Set(['contactName', 'contactPhone', 'name']);
const LIFECYCLE_FIELDS = new Set(['agentId', 'expectedVersion']);
const RESET_FIELDS = new Set(['agentId', 'expectedVersion', 'passwordHash']);
const HEX_64 = /^[a-f0-9]{64}$/;
const PHONE_LAST4 = /^[0-9]{4}$/;
const INVITE_LAST4 = /^\S{4}$/u;
const AUTHORIZATION_MODE = new Set<ProductAuthorizationMode>(['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST']);
const AGENT_STATUS = new Set<AgentStatus>(['ACTIVE', 'DISABLED']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): boolean {
  return isPlainObject(value) && Object.keys(value).every((field) => fields.has(field));
}

function requireExactFields(value: unknown, fields: ReadonlySet<string>, label: string): void {
  if (!isPlainObject(value) || !hasOnlyFields(value, fields) || Object.keys(value).length !== fields.size) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError('Expected Agent version must be a positive PostgreSQL INTEGER');
  }
}

function requireDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be a valid Date`);
}

function requireBoundedText(value: unknown, minimum: number, maximum: number, label: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${label} is invalid`);
  const characters = Array.from(value);
  const hasControlCharacter = characters.some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (characters.length < minimum || characters.length > maximum || value.trim() !== value || hasControlCharacter) {
    throw new TypeError(`${label} is invalid`);
  }
}

function requirePasswordHash(value: string): void {
  requireBoundedText(value, 20, 255, 'Agent password hash');
}

function requireEncryptedValue(
  value: AdminAgentContactPhoneMaterial,
  last4Pattern: RegExp,
  label: string,
  exactFields: ReadonlySet<string> = CONTACT_FIELDS,
): void {
  requireExactFields(value, exactFields, label);
  if (!(value.ciphertext instanceof Uint8Array) || value.ciphertext.byteLength === 0) {
    throw new TypeError(`${label} ciphertext is invalid`);
  }
  if (!last4Pattern.test(value.last4)) throw new TypeError(`${label} last four characters are invalid`);
  requireBoundedText(value.encryptionKeyId, 3, 80, `${label} encryption key ID`);
}

function validateListInput(input: AdminAgentListInput): void {
  if (!hasOnlyFields(input, LIST_FIELDS)) throw new TypeError('Agent list query contains unsupported fields');
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (input.keyword !== undefined) requireBoundedText(input.keyword, 1, 120, 'Agent list keyword');
  if (input.status !== undefined && !AGENT_STATUS.has(input.status)) throw new TypeError('Agent status is invalid');
  if (input.authorizationMode !== undefined && !AUTHORIZATION_MODE.has(input.authorizationMode)) {
    throw new TypeError('Agent authorization mode is invalid');
  }
  if (input.createdAtFrom !== undefined) requireDate(input.createdAtFrom, 'Agent created-from boundary');
  if (input.createdAtToExclusive !== undefined) requireDate(input.createdAtToExclusive, 'Agent created-to boundary');
  if (input.createdAtFrom && input.createdAtToExclusive &&
    input.createdAtToExclusive.getTime() <= input.createdAtFrom.getTime()) {
    throw new TypeError('Agent created-to boundary must be later than created-from');
  }
}

function validateCreateInput(input: CreateAdminAgentInput, now: Date): void {
  requireExactFields(input, CREATE_FIELDS, 'Create Agent input');
  for (const [value, label] of [
    [input.accountId, 'Agent account ID'],
    [input.agentId, 'Agent ID'],
    [input.walletId, 'Agent wallet ID'],
    [input.inviteCodeId, 'Agent invite-code ID'],
  ] as const) requireUlid(value, label);
  if (new Set([input.accountId, input.agentId, input.walletId, input.inviteCodeId]).size !== 4) {
    throw new TypeError('Agent resource IDs must be distinct');
  }
  requireBoundedText(input.agentNo, 1, 32, 'Agent number');
  requireBoundedText(input.loginName, 3, 80, 'Agent login name');
  requirePasswordHash(input.passwordHash);
  requireBoundedText(input.name, 1, 120, 'Agent name');
  if (input.contactName !== null) requireBoundedText(input.contactName, 1, 80, 'Agent contact name');
  if (input.contactPhone !== null) requireEncryptedValue(input.contactPhone, PHONE_LAST4, 'Agent contact phone');
  if (!AUTHORIZATION_MODE.has(input.productAuthorizationMode)) throw new TypeError('Agent authorization mode is invalid');
  requireExactFields(input.inviteCode, INVITE_FIELDS, 'Agent invite-code material');
  if (!HEX_64.test(input.inviteCode.codeHash)) throw new TypeError('Agent invite-code hash is invalid');
  requireEncryptedValue(input.inviteCode, INVITE_LAST4, 'Agent invite code', INVITE_FIELDS);
  if (input.inviteCode.expiresAt !== null) {
    requireDate(input.inviteCode.expiresAt, 'Agent invite-code expiry');
    if (input.inviteCode.expiresAt.getTime() <= now.getTime()) {
      throw new TypeError('Agent invite-code expiry must be in the future');
    }
  }
}

function validateUpdateInput(input: UpdateAdminAgentInput): void {
  requireExactFields(input, UPDATE_FIELDS, 'Update Agent input');
  requireUlid(input.agentId, 'Agent ID');
  requireVersion(input.expectedVersion);
  if (!hasOnlyFields(input.patch, UPDATE_PATCH_FIELDS) || Object.keys(input.patch).length === 0) {
    throw new TypeError('Update Agent patch contains unsupported fields or is empty');
  }
  if (input.patch.name !== undefined) requireBoundedText(input.patch.name, 1, 120, 'Agent name');
  if (input.patch.contactName !== undefined && input.patch.contactName !== null) {
    requireBoundedText(input.patch.contactName, 1, 80, 'Agent contact name');
  }
  if (input.patch.contactPhone !== undefined && input.patch.contactPhone !== null) {
    requireEncryptedValue(input.patch.contactPhone, PHONE_LAST4, 'Agent contact phone');
  }
}

function validateLifecycleInput(input: AdminAgentLifecycleInput): void {
  requireExactFields(input, LIFECYCLE_FIELDS, 'Agent lifecycle input');
  requireUlid(input.agentId, 'Agent ID');
  requireVersion(input.expectedVersion);
}

function validateResetInput(input: ResetAdminAgentPasswordInput): void {
  requireExactFields(input, RESET_FIELDS, 'Agent password-reset input');
  requireUlid(input.agentId, 'Agent ID');
  requireVersion(input.expectedVersion);
  requirePasswordHash(input.passwordHash);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Agent does not exist');
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Agent version changed');
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function storedDataError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function decimal(value: Prisma.Decimal | null | undefined, label: string): Prisma.Decimal {
  const result = value ?? new Prisma.Decimal(0);
  if (!Prisma.Decimal.isDecimal(result) || !result.isFinite() || result.decimalPlaces() > 2) {
    throw storedDataError(`${label} is invalid`);
  }
  return result;
}

function money(value: Prisma.Decimal | null | undefined, label: string): string {
  return decimal(value, label).toFixed(2);
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw storedDataError(`${label} is invalid`);
  return value;
}

function agentSnapshot(record: AgentRecord): AdminAgentSnapshot {
  if (record.deleted_at !== null || record.account.deleted_at !== null || record.account.role !== 'AGENT_ADMIN' ||
    record.account.login_name === null ||
    (record.status !== 'ACTIVE' && record.status !== 'DISABLED') ||
    (record.account.status !== 'ACTIVE' && record.account.status !== 'DISABLED') ||
    record.status !== record.account.status) {
    throw stateConflict('Agent account requires maintenance before management');
  }
  return {
    id: record.id,
    accountId: record.account_id,
    agentNo: record.agent_no,
    name: record.name,
    contactName: record.contact_name,
    contactPhoneTail: record.contact_phone_last4,
    status: record.status,
    productAuthorizationMode: record.product_authorization_mode,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    loginName: record.account.login_name,
    accountAlias: record.agent_no,
    accountStatus: record.account.status,
    accountVersion: record.account.version,
  };
}

function inviteSnapshot(
  record: AgentDetailRecord['invite_codes'][number],
  agentVersion: number,
  now: Date,
): AdminAgentInviteSnapshot {
  const status = record.status === 'ACTIVE' && record.expires_at !== null && record.expires_at.getTime() <= now.getTime()
    ? 'EXPIRED'
    : record.status;
  return {
    id: record.id,
    codeMasked: `****${record.code_last4}`,
    status,
    expiresAt: record.expires_at,
    version: agentVersion,
  };
}

function listWhere(input: AdminAgentListInput): Prisma.AgentProfileWhereInput {
  return {
    account: { is: { deleted_at: null, role: 'AGENT_ADMIN' } },
    deleted_at: null,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.authorizationMode === undefined
      ? {}
      : { product_authorization_mode: input.authorizationMode }),
    ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined
      ? {}
      : {
          created_at: {
            ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
            ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
          },
        }),
    ...(input.keyword === undefined
      ? {}
      : {
          OR: [
            { agent_no: { contains: input.keyword, mode: 'insensitive' } },
            { name: { contains: input.keyword, mode: 'insensitive' } },
            { account: { is: { login_name: { contains: input.keyword, mode: 'insensitive' } } } },
          ],
        }),
  };
}

export class AdminAgentRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    requireDate(value, 'Admin Agent repository clock');
    return value;
  }

  async listAgents(input: AdminAgentListInput): Promise<AdminAgentListResult> {
    validateListInput(input);
    const where = listWhere(input);
    const [records, total] = await Promise.all([
      this.prisma.agentProfile.findMany({
        include: AGENT_LIST_INCLUDE,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.agentProfile.count({ where }),
    ]);
    if (records.length === 0) return { items: [], total: count(total, 'Agent list total') };

    const agentIds = records.map(({ id }) => id);
    const [bindings, sales] = await Promise.all([
      this.prisma.customerAgentBinding.groupBy({
        _count: { _all: true },
        by: ['agent_id'],
        where: { agent_id: { in: agentIds }, ended_at: null },
      }),
      this.prisma.salesOrder.groupBy({
        _sum: { paid_amount: true, refunded_amount: true },
        by: ['final_agent_id'],
        where: { final_agent_id: { in: agentIds }, payment_status: 'PAID' },
      }),
    ]);
    const bindingByAgent = new Map(bindings.map((row) => [row.agent_id, row._count._all]));
    const salesByAgent = new Map(sales.flatMap((row) => row.final_agent_id === null ? [] : [[row.final_agent_id, row]]));
    return {
      items: records.map((record) => {
        const sale = salesByAgent.get(record.id);
        const netSales = decimal(sale?._sum.paid_amount, 'Agent paid amount')
          .minus(decimal(sale?._sum.refunded_amount, 'Agent refunded amount'));
        return {
          ...agentSnapshot(record),
          activeCustomerCount: count(bindingByAgent.get(record.id) ?? 0, 'Agent active-customer count'),
          netSalesAmount: money(netSales, 'Agent net sales amount'),
          availableBalance: money(record.wallet?.available_balance, 'Agent available balance'),
        };
      }),
      total: count(total, 'Agent list total'),
    };
  }

  async getAgentDetail(agentId: string): Promise<AdminAgentDetail> {
    requireUlid(agentId, 'Agent ID');
    const record = await this.prisma.agentProfile.findFirst({
      include: AGENT_DETAIL_INCLUDE,
      where: {
        account: { is: { deleted_at: null, role: 'AGENT_ADMIN' } },
        deleted_at: null,
        id: agentId,
      },
    });
    if (!record) throw notFound();
    const agent = agentSnapshot(record);
    const [sales, activeCustomers, allBindings, expectedCommission, withdrawalGroups, latestWithdrawal] =
      await Promise.all([
        this.prisma.salesOrder.aggregate({
          _count: { _all: true },
          _sum: { paid_amount: true, refunded_amount: true },
          where: { final_agent_id: agentId, payment_status: 'PAID' },
        }),
        this.prisma.customerAgentBinding.count({ where: { agent_id: agentId, ended_at: null } }),
        this.prisma.customerAgentBinding.count({ where: { agent_id: agentId } }),
        this.prisma.commissionLedger.aggregate({
          _sum: { expected_change: true },
          where: { agent_id: agentId },
        }),
        this.prisma.withdrawal.groupBy({
          _count: { _all: true },
          _sum: { amount: true },
          by: ['status'],
          where: { agent_id: agentId },
        }),
        this.prisma.withdrawal.aggregate({
          _max: { created_at: true },
          where: { agent_id: agentId },
        }),
      ]);

    const paidAmount = decimal(sales._sum.paid_amount, 'Agent paid amount');
    const refundedAmount = decimal(sales._sum.refunded_amount, 'Agent refunded amount');
    const expected = decimal(expectedCommission._sum.expected_change, 'Agent expected commission');
    if (expected.isNegative()) throw storedDataError('Agent expected commission is negative');
    const available = decimal(record.wallet?.available_balance, 'Agent available balance');
    const frozen = decimal(record.wallet?.frozen_balance, 'Agent frozen balance');
    if (frozen.isNegative()) throw storedDataError('Agent frozen balance is negative');
    const withdrawalByStatus = new Map(withdrawalGroups.map((row) => [row.status, row]));
    const paidWithdrawal = withdrawalByStatus.get('PAID');
    const paidWithdrawalTotal = decimal(paidWithdrawal?._sum.amount, 'Paid withdrawal total');
    if (paidWithdrawalTotal.isNegative()) throw storedDataError('Paid withdrawal total is negative');

    return {
      agent,
      inviteCode: record.invite_codes[0]
        ? inviteSnapshot(record.invite_codes[0], record.version, this.currentTime())
        : null,
      operatingSummary: {
        netSalesAmount: money(paidAmount.minus(refundedAmount), 'Agent net sales amount'),
        paidOrderCount: count(sales._count._all, 'Agent paid-order count'),
        activeCustomerCount: count(activeCustomers, 'Agent active-customer count'),
        newBindingCount: count(allBindings, 'Agent new-binding count'),
      },
      walletSummary: {
        expectedCommission: money(expected, 'Agent expected commission'),
        availableBalance: money(available, 'Agent available balance'),
        frozenBalance: money(frozen, 'Agent frozen balance'),
        negativeBalance: money(available.isNegative() ? available.negated() : new Prisma.Decimal(0),
          'Agent negative balance'),
        version: record.wallet?.version ?? 1,
      },
      withdrawalSummary: {
        pendingCount: count(withdrawalByStatus.get('PENDING')?._count._all ?? 0, 'Pending withdrawal count'),
        approvedCount: count(withdrawalByStatus.get('APPROVED')?._count._all ?? 0, 'Approved withdrawal count'),
        paidCount: count(paidWithdrawal?._count._all ?? 0, 'Paid withdrawal count'),
        totalPaidAmount: money(paidWithdrawalTotal, 'Paid withdrawal total'),
        latestWithdrawalAt: latestWithdrawal._max.created_at,
      },
    };
  }

  async createAgentInTransaction(
    transaction: DatabaseTransaction,
    input: CreateAdminAgentInput,
  ): Promise<CreateAdminAgentResult> {
    const now = this.currentTime();
    validateCreateInput(input, now);
    await acquireTransactionLock(transaction, 'admin-agent-login', [input.loginName]);
    await acquireTransactionLock(transaction, 'admin-agent-number', [input.agentNo]);
    await acquireTransactionLock(transaction, 'admin-agent-invite', [input.inviteCode.codeHash]);
    if (await transaction.account.findUnique({ select: { id: true }, where: { login_name: input.loginName } }) ||
      await transaction.agentProfile.findUnique({ select: { id: true }, where: { agent_no: input.agentNo } }) ||
      await transaction.agentInviteCode.findUnique({ select: { id: true }, where: { code_hash: input.inviteCode.codeHash } })) {
      throw stateConflict('Agent login, number, or invite code is already reserved');
    }

    await transaction.account.create({
      data: {
        id: input.accountId,
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        login_name: input.loginName,
        password_hash: input.passwordHash,
        must_change_password: true,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    });
    await transaction.agentProfile.create({
      data: {
        id: input.agentId,
        account_id: input.accountId,
        agent_no: input.agentNo,
        name: input.name,
        contact_name: input.contactName,
        contact_phone_ciphertext: input.contactPhone === null ? null : Buffer.from(input.contactPhone.ciphertext),
        contact_phone_last4: input.contactPhone?.last4 ?? null,
        contact_phone_encryption_key_id: input.contactPhone?.encryptionKeyId ?? null,
        status: 'ACTIVE',
        product_authorization_mode: input.productAuthorizationMode,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    });
    await transaction.agentWallet.create({
      data: {
        id: input.walletId,
        agent_id: input.agentId,
        available_balance: new Prisma.Decimal(0),
        frozen_balance: new Prisma.Decimal(0),
        version: 1,
        updated_at: now,
      },
    });
    await transaction.agentInviteCode.create({
      data: {
        id: input.inviteCodeId,
        agent_id: input.agentId,
        code_hash: input.inviteCode.codeHash,
        code_ciphertext: Buffer.from(input.inviteCode.ciphertext),
        code_last4: input.inviteCode.last4,
        encryption_key_id: input.inviteCode.encryptionKeyId,
        status: 'ACTIVE',
        effective_at: now,
        expires_at: input.inviteCode.expiresAt,
        ended_at: null,
        end_reason: null,
        created_at: now,
      },
    });
    const created = await transaction.agentProfile.findUnique({
      include: AGENT_LIST_INCLUDE,
      where: { id: input.agentId },
    });
    if (!created) throw storedDataError('Created Agent could not be reloaded');
    return {
      agent: agentSnapshot(created),
      initialInviteCode: {
        id: input.inviteCodeId,
        codeMasked: `****${input.inviteCode.last4}`,
        status: 'ACTIVE',
        expiresAt: input.inviteCode.expiresAt,
        version: 1,
      },
    };
  }

  async updateAgentInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateAdminAgentInput,
  ): Promise<AdminAgentSnapshot> {
    validateUpdateInput(input);
    const current = await this.lockAgent(transaction, input.agentId);
    if (current.version !== input.expectedVersion) throw versionConflict();
    const data: Prisma.AgentProfileUpdateManyMutationInput = {
      updated_at: this.currentTime(),
      version: { increment: 1 },
      ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
      ...(input.patch.contactName === undefined ? {} : { contact_name: input.patch.contactName }),
      ...(input.patch.contactPhone === undefined
        ? {}
        : input.patch.contactPhone === null
          ? {
              contact_phone_ciphertext: null,
              contact_phone_encryption_key_id: null,
              contact_phone_last4: null,
            }
          : {
              contact_phone_ciphertext: Buffer.from(input.patch.contactPhone.ciphertext),
              contact_phone_encryption_key_id: input.patch.contactPhone.encryptionKeyId,
              contact_phone_last4: input.patch.contactPhone.last4,
            }),
    };
    const updated = await transaction.agentProfile.updateMany({
      data,
      where: { deleted_at: null, id: input.agentId, version: input.expectedVersion },
    });
    if (updated.count !== 1) throw versionConflict();
    return this.reloadAgent(transaction, input.agentId);
  }

  async getDisableImpactInTransaction(
    transaction: DatabaseTransaction,
    agentId: string,
  ): Promise<AdminAgentDisableImpact> {
    requireUlid(agentId, 'Agent ID');
    const record = await this.findAgent(transaction, agentId);
    return this.calculateDisableImpact(transaction, agentId, record, this.currentTime());
  }

  private async calculateDisableImpact(
    transaction: DatabaseTransaction,
    agentId: string,
    record: AgentListRecord,
    now: Date,
  ): Promise<AdminAgentDisableImpact> {
    if (record.status !== 'ACTIVE' || record.account.status !== 'ACTIVE') {
      throw stateConflict('Only an active Agent can be disabled');
    }
    const [activeSessionCount, activeInviteCount, activeCandidateCount, pendingPaymentOrderCount] = await Promise.all([
      transaction.authSession.count({
        where: {
          account_id: record.account_id,
          assurance: 'PASSWORD',
          expires_at: { gt: now },
          revoked_at: null,
        },
      }),
      transaction.agentInviteCode.count({
        where: {
          agent_id: agentId,
          status: 'ACTIVE',
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
      }),
      transaction.attributionCandidate.count({
        where: { agent_id: agentId, expires_at: { gt: now }, status: 'ACTIVE' },
      }),
      transaction.orderAttributionCandidate.count({
        where: {
          candidate_agent_id: agentId,
          finalized_at: null,
          order: {
            is: {
              order_status: 'PENDING_PAYMENT',
              payment_status: { in: ['UNPAID', 'PROCESSING'] },
            },
          },
        },
      }),
    ]);
    return {
      agent: agentSnapshot(record),
      activeSessionCount: count(activeSessionCount, 'Active Agent session count'),
      activeInviteCount: count(activeInviteCount, 'Active Agent invite-code count'),
      activeCandidateCount: count(activeCandidateCount, 'Active Agent candidate count'),
      pendingPaymentOrderCount: count(pendingPaymentOrderCount, 'Pending Agent payment-order count'),
    };
  }

  async disableAgentInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAgentLifecycleInput,
  ): Promise<AdminAgentLifecycleResult> {
    validateLifecycleInput(input);
    const now = this.currentTime();
    const current = await this.lockAgent(transaction, input.agentId);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'ACTIVE' || current.account.status !== 'ACTIVE') {
      throw stateConflict('Only an active Agent can be disabled');
    }
    await this.lockAgentSessions(transaction, current.account_id);
    const profileUpdated = await transaction.agentProfile.updateMany({
      data: { status: 'DISABLED', updated_at: now, version: { increment: 1 } },
      where: { id: input.agentId, status: 'ACTIVE', version: input.expectedVersion },
    });
    const accountUpdated = await transaction.account.updateMany({
      data: { status: 'DISABLED', updated_at: now, version: { increment: 1 } },
      where: { id: current.account_id, role: 'AGENT_ADMIN', status: 'ACTIVE', version: current.account.version },
    });
    if (profileUpdated.count !== 1 || accountUpdated.count !== 1) throw versionConflict();
    const revoked = await transaction.authSession.updateMany({
      data: { last_seen_at: now, revoked_at: now },
      where: { account_id: current.account_id, assurance: 'PASSWORD', revoked_at: null },
    });
    await transaction.attributionCandidate.updateMany({
      data: { invalid_reason: 'AGENT_DISABLED', status: 'INVALIDATED', updated_at: now },
      where: { agent_id: input.agentId, expires_at: { gt: now }, status: 'ACTIVE' },
    });
    const agent = await this.reloadAgent(transaction, input.agentId);
    return { agent, accountVersion: agent.accountVersion, revokedSessionCount: revoked.count, occurredAt: now };
  }

  async reactivateAgentInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAgentLifecycleInput,
  ): Promise<AdminAgentLifecycleResult> {
    validateLifecycleInput(input);
    const now = this.currentTime();
    const current = await this.lockAgent(transaction, input.agentId);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'DISABLED' || current.account.status !== 'DISABLED') {
      throw stateConflict('Only a disabled Agent can be reactivated');
    }
    const profileUpdated = await transaction.agentProfile.updateMany({
      data: { status: 'ACTIVE', updated_at: now, version: { increment: 1 } },
      where: { id: input.agentId, status: 'DISABLED', version: input.expectedVersion },
    });
    const accountUpdated = await transaction.account.updateMany({
      data: { status: 'ACTIVE', updated_at: now, version: { increment: 1 } },
      where: { id: current.account_id, role: 'AGENT_ADMIN', status: 'DISABLED', version: current.account.version },
    });
    if (profileUpdated.count !== 1 || accountUpdated.count !== 1) throw versionConflict();
    const agent = await this.reloadAgent(transaction, input.agentId);
    return { agent, accountVersion: agent.accountVersion, revokedSessionCount: 0, occurredAt: now };
  }

  async getPasswordResetImpactInTransaction(
    transaction: DatabaseTransaction,
    agentId: string,
  ): Promise<AdminAgentPasswordResetImpact> {
    requireUlid(agentId, 'Agent ID');
    const record = await this.findAgent(transaction, agentId);
    return this.calculatePasswordResetImpact(transaction, record, this.currentTime());
  }

  private async calculatePasswordResetImpact(
    transaction: DatabaseTransaction,
    record: AgentListRecord,
    now: Date,
  ): Promise<AdminAgentPasswordResetImpact> {
    const activeSessionCount = await transaction.authSession.count({
      where: {
        account_id: record.account_id,
        assurance: 'PASSWORD',
        expires_at: { gt: now },
        revoked_at: null,
      },
    });
    return {
      agent: agentSnapshot(record),
      activeSessionCount: count(activeSessionCount, 'Active Agent session count'),
    };
  }

  async resetAgentPasswordInTransaction(
    transaction: DatabaseTransaction,
    input: ResetAdminAgentPasswordInput,
  ): Promise<AdminAgentLifecycleResult> {
    validateResetInput(input);
    const now = this.currentTime();
    const current = await this.lockAgent(transaction, input.agentId);
    if (current.version !== input.expectedVersion) throw versionConflict();
    await this.lockAgentSessions(transaction, current.account_id);
    const accountUpdated = await transaction.account.updateMany({
      data: {
        must_change_password: true,
        password_hash: input.passwordHash,
        updated_at: now,
        version: { increment: 1 },
      },
      where: { id: current.account_id, role: 'AGENT_ADMIN', version: current.account.version },
    });
    const profileUpdated = await transaction.agentProfile.updateMany({
      data: { updated_at: now, version: { increment: 1 } },
      where: { id: input.agentId, version: input.expectedVersion },
    });
    if (accountUpdated.count !== 1 || profileUpdated.count !== 1) throw versionConflict();
    const revoked = await transaction.authSession.updateMany({
      data: { last_seen_at: now, revoked_at: now },
      where: { account_id: current.account_id, assurance: 'PASSWORD', revoked_at: null },
    });
    const agent = await this.reloadAgent(transaction, input.agentId);
    return { agent, accountVersion: agent.accountVersion, revokedSessionCount: revoked.count, occurredAt: now };
  }

  private async findAgent(transaction: DatabaseTransaction, agentId: string): Promise<AgentListRecord> {
    const record = await transaction.agentProfile.findFirst({
      include: AGENT_LIST_INCLUDE,
      where: {
        account: { is: { deleted_at: null, role: 'AGENT_ADMIN' } },
        deleted_at: null,
        id: agentId,
      },
    });
    if (!record) throw notFound();
    agentSnapshot(record);
    return record;
  }

  private async lockAgent(transaction: DatabaseTransaction, agentId: string): Promise<AgentListRecord> {
    await acquireTransactionLock(transaction, 'store-attribution-agent', [agentId]);
    const profileRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.agent_profile WHERE id = ${agentId} FOR UPDATE
    `);
    if (profileRows.length !== 1 || profileRows[0]?.id !== agentId) throw notFound();
    const record = await this.findAgent(transaction, agentId);
    await acquireTransactionLock(transaction, 'agent-auth-account', [record.account_id]);
    const accountRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.account WHERE id = ${record.account_id} FOR UPDATE
    `);
    if (accountRows.length !== 1 || accountRows[0]?.id !== record.account_id) throw notFound();
    return this.findAgent(transaction, agentId);
  }

  private async lockAgentSessions(transaction: DatabaseTransaction, accountId: string): Promise<void> {
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [accountId]);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.auth_session
      WHERE account_id = ${accountId} AND assurance = 'PASSWORD'
      ORDER BY id ASC
      FOR UPDATE
    `);
  }

  private async reloadAgent(transaction: DatabaseTransaction, agentId: string): Promise<AdminAgentSnapshot> {
    const record = await transaction.agentProfile.findUnique({
      include: AGENT_LIST_INCLUDE,
      where: { id: agentId },
    });
    if (!record) throw storedDataError('Updated Agent could not be reloaded');
    return agentSnapshot(record);
  }
}
