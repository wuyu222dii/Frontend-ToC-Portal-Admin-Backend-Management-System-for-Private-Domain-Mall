import type { components, operations } from '@qingxu/contracts';

type Schemas = components['schemas'];
type ResponseData<Name extends keyof Schemas> = Schemas[Name] extends { data: infer Data }
  ? Data
  : never;

export type AgentErrorResponse = Schemas['ErrorResponse'];
export type AgentCommand = ResponseData<'CommandResponse'>;
export type AgentSession = Schemas['AgentSessionData'];
export type RestrictedAgentSession = Schemas['RestrictedAgentSessionData'];
export type AgentLoginResult = AgentSession | RestrictedAgentSession;
export type AgentCurrent = Schemas['AgentCurrentView'];

export type AgentLoginInput = Schemas['PasswordLoginRequest'];
export type AgentPasswordChangeInput = Schemas['ChangePasswordRequest'];
export type AgentPromotionInput = Schemas['CreatePromotionAssetRequest'];
export type AgentBankAccountInput = Schemas['BankAccountWriteRequest'];
export type AgentWithdrawalInput = Schemas['CreateWithdrawalRequest'];

export type AgentDashboard = ResponseData<'AgentDashboardResponse'>;
export type AgentDashboardDays = NonNullable<
  NonNullable<operations['getAgentDashboard']['parameters']['query']>['days']
>;
export type AgentProduct = Schemas['AgentProductProjection'];
export type AgentProductList = ResponseData<'AgentProductListResponse'>;
export type StoreBrandList = ResponseData<'StoreBrandListResponse'>;
export type StoreBrand = Schemas['StoreBrandView'];
export type StoreCategoryList = ResponseData<'StoreCategoryListResponse'>;
export type StoreCategory = Schemas['StoreCategoryView'];
export type AgentPromotion = ResponseData<'PromotionAssetResponse'>;
export type AgentFileDownload = ResponseData<'FileDownloadUrlResponse'>;
export type AgentCustomerListItem = Schemas['AgentCustomerListItem'];
export type AgentCustomerList = ResponseData<'AgentCustomerListResponse'>;
export type AgentCustomerDetail = ResponseData<'AgentCustomerDetailResponse'>;
export type AgentOrderListItem = Schemas['AgentOrderListItem'];
export type AgentOrderList = ResponseData<'AgentOrderListResponse'>;
export type AgentOrderDetail = ResponseData<'AgentOrderResponse'>;
export type AgentCommission = Schemas['AgentCommissionLedgerItem'];
export type AgentCommissionList = ResponseData<'CommissionListResponse'>;
export type AgentCommissionDetail = ResponseData<'AgentCommissionDetailResponse'>;
export type AgentWallet = ResponseData<'WalletResponse'>;
export type AgentBankAccount = Schemas['BankAccountView'];
export type AgentWithdrawal = Schemas['WithdrawalView'];
export type AgentWithdrawalList = ResponseData<'WithdrawalListResponse'>;

export type AgentProductWireQuery = NonNullable<
  operations['getAgentProducts']['parameters']['query']
>;
export type AgentCustomerWireQuery = NonNullable<
  operations['getAgentCustomers']['parameters']['query']
>;
export type AgentOrderWireQuery = NonNullable<operations['getAgentOrders']['parameters']['query']>;
export type AgentCommissionWireQuery = NonNullable<
  operations['getAgentCommissions']['parameters']['query']
>;
export type AgentWithdrawalWireQuery = NonNullable<
  operations['getAgentWithdrawals']['parameters']['query']
>;

export interface AgentProductQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  keyword?: string | undefined;
  brandId?: string | undefined;
  categoryId?: string | undefined;
  recommended?: boolean | undefined;
}

export interface AgentCustomerQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  keyword?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export interface AgentOrderQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  customerId?: string | undefined;
  orderNo?: string | undefined;
  orderStatus?: AgentOrderWireQuery['order_status'] | undefined;
  refundProgressStatus?: AgentOrderWireQuery['refund_progress_status'] | undefined;
  refundProcessingStatus?: AgentOrderWireQuery['refund_processing_status'] | undefined;
  fulfillmentStatus?: AgentOrderWireQuery['fulfillment_status'] | undefined;
  hasAftersale?: boolean | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
  sort?: AgentOrderWireQuery['sort'] | undefined;
}

export interface AgentCommissionQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  state?: AgentCommissionWireQuery['state'] | undefined;
  ledgerType?: AgentCommissionWireQuery['ledger_type'] | undefined;
  orderNo?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export interface AgentWithdrawalQuery {
  page?: number | undefined;
  pageSize?: number | undefined;
  withdrawalNo?: string | undefined;
  status?: AgentWithdrawalWireQuery['status'] | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
}
