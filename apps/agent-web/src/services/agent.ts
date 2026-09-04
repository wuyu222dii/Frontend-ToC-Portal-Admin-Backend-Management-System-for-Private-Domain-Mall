import { agentAuthSession } from '../stores/auth-session';
import type {
  AgentBankAccount,
  AgentBankAccountInput,
  AgentCommand,
  AgentCommissionDetail,
  AgentCommissionList,
  AgentCommissionQuery,
  AgentCurrent,
  AgentCustomerDetail,
  AgentCustomerList,
  AgentCustomerQuery,
  AgentDashboard,
  AgentDashboardDays,
  AgentFileDownload,
  AgentLoginInput,
  AgentLoginResult,
  AgentOrderDetail,
  AgentOrderList,
  AgentOrderQuery,
  AgentPasswordChangeInput,
  AgentProduct,
  AgentProductList,
  AgentProductQuery,
  AgentPromotion,
  AgentPromotionInput,
  AgentSession,
  AgentWallet,
  AgentWithdrawal,
  AgentWithdrawalInput,
  AgentWithdrawalList,
  AgentWithdrawalQuery,
  StoreBrandList,
  StoreCategoryList,
} from '../types/agent';
import {
  AgentApiError,
  agentEitherSessionRequest,
  agentPublicRequest,
  agentRestrictedRequest,
  agentSessionRequest,
  newIdempotencyKey,
} from './agent-api';
import {
  decodeAgentBankAccount,
  decodeAgentBankAccountList,
  decodeAgentCommand,
  decodeAgentCommissionDetail,
  decodeAgentCommissionList,
  decodeAgentCurrent,
  decodeAgentCustomerDetail,
  decodeAgentCustomerList,
  decodeAgentDashboard,
  decodeAgentFileDownload,
  decodeAgentLoginResult,
  decodeAgentOrderDetail,
  decodeAgentOrderList,
  decodeAgentProduct,
  decodeAgentProductList,
  decodeAgentPromotion,
  decodeAgentSession,
  decodeAgentWallet,
  decodeAgentWithdrawal,
  decodeAgentWithdrawalList,
  decodeStoreBrandList,
  decodeStoreCategoryList,
} from './agent-decoders';

export { AgentApiError, agentAuthSession, newIdempotencyKey };
export type * from '../types/agent';

function invalidResponse(message: string): never {
  throw new AgentApiError(message, { status: 502, code: 'INVALID_RESPONSE' });
}

function resourceId(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new AgentApiError(`${name}不能为空`, { status: 400, code: 'INVALID_ARGUMENT' });
  }
  return encodeURIComponent(value);
}

function currentAgentId(): string {
  const id = agentAuthSession.state.current?.agent_id;
  if (!id) {
    throw new AgentApiError('代理身份尚未加载', { status: 409, code: 'CURRENT_AGENT_REQUIRED' });
  }
  return id;
}

function bind(value: string, expected: string, label: string): void {
  if (value !== expected) invalidResponse(`服务响应中的${label}不匹配`);
}

function queryString(entries: ReadonlyArray<readonly [string, string | number | boolean | undefined]>): string {
  const search = new URLSearchParams();
  for (const [name, value] of entries) {
    if (value !== undefined) search.set(name, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

export function loginAgent(
  input: AgentLoginInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentLoginResult> {
  return agentPublicRequest('/agent/auth/login', {
    method: 'POST',
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentLoginResult,
  });
}

export function changeTemporaryAgentPassword(
  input: AgentPasswordChangeInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentSession> {
  return agentRestrictedRequest('/agent/auth/change-temporary-password', {
    method: 'POST',
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentSession,
  });
}

export function changeAgentPassword(
  input: AgentPasswordChangeInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentCommand> {
  return agentSessionRequest('/agent/auth/change-password', {
    method: 'POST',
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentCommand,
  });
}

export function logoutAgent(idempotencyKey: string, signal?: AbortSignal): Promise<AgentCommand> {
  return agentEitherSessionRequest('/agent/auth/logout', {
    method: 'POST',
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentCommand,
  });
}

export function logoutAllAgent(idempotencyKey: string, signal?: AbortSignal): Promise<AgentCommand> {
  return agentSessionRequest('/agent/auth/logout-all', {
    method: 'POST',
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentCommand,
  });
}

export async function getAgentCurrent(signal?: AbortSignal): Promise<AgentCurrent> {
  const current = await agentSessionRequest('/agent/auth/current', {
    expectedStatus: 200,
    signal,
    decode: decodeAgentCurrent,
  });
  agentAuthSession.acceptCurrent(current);
  return current;
}

export async function getAgentDashboard(
  days: AgentDashboardDays = 7,
  signal?: AbortSignal,
): Promise<AgentDashboard> {
  const expectedAgentId = currentAgentId();
  const result = await agentSessionRequest(`/agent/dashboard${queryString([['days', days]])}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentDashboard,
  });
  bind(result.agent_id, expectedAgentId, '代理 ID');
  return result;
}

export function listAgentProducts(
  query: AgentProductQuery = {},
  signal?: AbortSignal,
): Promise<AgentProductList> {
  const suffix = queryString([
    ['page', query.page],
    ['page_size', query.pageSize],
    ['keyword', query.keyword],
    ['brand_id', query.brandId],
    ['category_id', query.categoryId],
    ['recommended', query.recommended],
  ]);
  return agentSessionRequest(`/agent/products${suffix}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentProductList,
  });
}

export async function getAgentProductFilterOptions(signal?: AbortSignal): Promise<{
  brands: StoreBrandList['items'];
  categories: StoreCategoryList['items'];
}> {
  const [brands, categories] = await Promise.all([
    agentPublicRequest('/store/brands', { expectedStatus: 200, signal, decode: decodeStoreBrandList }),
    agentPublicRequest('/store/categories', { expectedStatus: 200, signal, decode: decodeStoreCategoryList }),
  ]);
  return { brands: brands.items, categories: categories.items };
}

export async function getAgentProduct(productId: string, signal?: AbortSignal): Promise<AgentProduct> {
  const result = await agentSessionRequest(`/agent/products/${resourceId(productId, '商品 ID')}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentProduct,
  });
  bind(result.product_id, productId, '商品 ID');
  return result;
}

export async function createAgentPromotion(
  input: AgentPromotionInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentPromotion> {
  const result = await agentSessionRequest('/agent/promotion-assets', {
    method: 'POST',
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentPromotion,
  });
  bind(result.target_type, input.target_type, '推广目标类型');
  if (input.target_type === 'PRODUCT') {
    if (!input.target_id) invalidResponse('商品推广响应缺少目标 ID');
    bind(result.target_id ?? '', input.target_id, '推广目标 ID');
  } else if (result.target_id !== undefined && result.target_id !== null) {
    invalidResponse('商城推广响应不得包含目标 ID');
  }
  return result;
}

export async function getAgentQrDownloadUrl(
  fileId: string,
  signal?: AbortSignal,
): Promise<AgentFileDownload> {
  const result = await agentSessionRequest(`/files/${resourceId(fileId, '文件 ID')}/download-url`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentFileDownload,
  });
  bind(result.file_id, fileId, '文件 ID');
  return result;
}

export function listAgentCustomers(
  query: AgentCustomerQuery = {},
  signal?: AbortSignal,
): Promise<AgentCustomerList> {
  const suffix = queryString([
    ['page', query.page],
    ['page_size', query.pageSize],
    ['keyword', query.keyword],
    ['date_from', query.dateFrom],
    ['date_to', query.dateTo],
  ]);
  return agentSessionRequest(`/agent/customers${suffix}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentCustomerList,
  });
}

export async function getAgentCustomer(
  customerId: string,
  signal?: AbortSignal,
): Promise<AgentCustomerDetail> {
  const expectedAgentId = currentAgentId();
  const result = await agentSessionRequest(`/agent/customers/${resourceId(customerId, '客户 ID')}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentCustomerDetail,
  });
  bind(result.customer.customer_id, customerId, '客户 ID');
  bind(result.customer.binding?.customer_id ?? '', customerId, '归属客户 ID');
  bind(result.customer.binding?.agent_id ?? '', expectedAgentId, '归属代理 ID');
  bind(result.binding_period.binding_id, result.customer.binding?.binding_id ?? '', '归属期 ID');
  if (result.binding_period.ended_at !== null) invalidResponse('当前归属期不应已结束');
  return result;
}

export async function listAgentOrders(
  query: AgentOrderQuery = {},
  signal?: AbortSignal,
): Promise<AgentOrderList> {
  const expectedAgentId = currentAgentId();
  const suffix = queryString([
    ['page', query.page],
    ['page_size', query.pageSize],
    ['customer_id', query.customerId],
    ['order_no', query.orderNo],
    ['order_status', query.orderStatus],
    ['refund_progress_status', query.refundProgressStatus],
    ['refund_processing_status', query.refundProcessingStatus],
    ['fulfillment_status', query.fulfillmentStatus],
    ['has_aftersale', query.hasAftersale],
    ['date_from', query.dateFrom],
    ['date_to', query.dateTo],
    ['min_amount', query.minAmount],
    ['max_amount', query.maxAmount],
    ['sort', query.sort],
  ]);
  const result = await agentSessionRequest(`/agent/orders${suffix}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentOrderList,
  });
  for (const order of result.items) bind(order.final_agent_id, expectedAgentId, '订单归属代理 ID');
  return result;
}

export async function getAgentOrder(orderId: string, signal?: AbortSignal): Promise<AgentOrderDetail> {
  const expectedAgentId = currentAgentId();
  const result = await agentSessionRequest(`/agent/orders/${resourceId(orderId, '订单 ID')}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentOrderDetail,
  });
  bind(result.order_id, orderId, '订单 ID');
  bind(result.final_agent_id, expectedAgentId, '订单归属代理 ID');
  return result;
}

export function listAgentCommissions(
  query: AgentCommissionQuery = {},
  signal?: AbortSignal,
): Promise<AgentCommissionList> {
  const suffix = queryString([
    ['page', query.page],
    ['page_size', query.pageSize],
    ['state', query.state],
    ['ledger_type', query.ledgerType],
    ['order_no', query.orderNo],
    ['date_from', query.dateFrom],
    ['date_to', query.dateTo],
  ]);
  return agentSessionRequest(`/agent/commissions${suffix}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentCommissionList,
  });
}

export async function getAgentCommission(
  commissionSnapshotId: string,
  signal?: AbortSignal,
): Promise<AgentCommissionDetail> {
  const result = await agentSessionRequest(
    `/agent/commissions/${resourceId(commissionSnapshotId, '佣金快照 ID')}`,
    { expectedStatus: 200, signal, decode: decodeAgentCommissionDetail },
  );
  bind(result.item.commission_snapshot_id, commissionSnapshotId, '佣金快照 ID');
  return result;
}

export function getAgentWallet(signal?: AbortSignal): Promise<AgentWallet> {
  return agentSessionRequest('/agent/wallet', {
    expectedStatus: 200,
    signal,
    decode: decodeAgentWallet,
  });
}

export function listAgentBankAccounts(signal?: AbortSignal): Promise<AgentBankAccount[]> {
  return agentSessionRequest('/agent/bank-accounts', {
    expectedStatus: 200,
    signal,
    decode: decodeAgentBankAccountList,
  });
}

export function replaceAgentBankAccount(
  input: AgentBankAccountInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentBankAccount> {
  return agentSessionRequest('/agent/bank-accounts', {
    method: 'POST',
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    signal,
    decode: decodeAgentBankAccount,
  });
}

export function listAgentWithdrawals(
  query: AgentWithdrawalQuery = {},
  signal?: AbortSignal,
): Promise<AgentWithdrawalList> {
  const suffix = queryString([
    ['page', query.page],
    ['page_size', query.pageSize],
    ['withdrawal_no', query.withdrawalNo],
    ['status', query.status],
    ['date_from', query.dateFrom],
    ['date_to', query.dateTo],
    ['min_amount', query.minAmount],
    ['max_amount', query.maxAmount],
  ]);
  return agentSessionRequest(`/agent/withdrawals${suffix}`, {
    expectedStatus: 200,
    signal,
    decode: decodeAgentWithdrawalList,
  });
}

export function createAgentWithdrawal(
  input: AgentWithdrawalInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentWithdrawal> {
  return agentSessionRequest('/agent/withdrawals', {
    method: 'POST',
    body: input,
    expectedStatus: 201,
    idempotencyKey,
    signal,
    decode: decodeAgentWithdrawal,
  });
}

export async function getAgentWithdrawal(
  withdrawalId: string,
  signal?: AbortSignal,
): Promise<AgentWithdrawal> {
  const result = await agentSessionRequest(
    `/agent/withdrawals/${resourceId(withdrawalId, '提现 ID')}`,
    { expectedStatus: 200, signal, decode: decodeAgentWithdrawal },
  );
  bind(result.withdrawal_id, withdrawalId, '提现 ID');
  return result;
}
