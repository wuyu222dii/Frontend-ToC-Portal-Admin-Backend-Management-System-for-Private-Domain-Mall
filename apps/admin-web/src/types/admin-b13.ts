import type { components } from '@qingxu/contracts';

type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

export type HighRiskPreview = Schema<'HighRiskPreviewResponse'>['data'];
export type AdminCommandResult = Schema<'CommandResponse'>['data'];
export type ReasonInput = Schema<'ReasonAction'>;

export type AdminCustomer = Schema<'AdminCustomerView'>;
export type AdminCustomerDetail = Schema<'AdminCustomerDetailResponse'>['data'];
export type AdminCustomerListResult = Schema<'AdminCustomerListResponse'>['data'];
export type CustomerTransferInput = Schema<'CustomerTransferAction'>;

export interface AdminCustomerListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  bindingStatus?: 'BOUND' | 'UNBOUND' | 'ENDED';
  dateFrom?: string;
  dateTo?: string;
  agentId?: string;
  minConsumption?: string;
  maxConsumption?: string;
}

export type AdminAgent = Schema<'AgentView'>;
export type AdminAgentListItem = Schema<'AdminAgentListItem'>;
export type AdminAgentDetail = Schema<'AdminAgentDetailResponse'>['data'];
export type AdminAgentListResult = Schema<'AdminAgentListResponse'>['data'];
export type AgentCreateInput = Schema<'AgentCreateRequest'>;
export type AgentCreateResult = Schema<'AgentCreateResponse'>['data'];
export type AgentUpdateInput = Schema<'AgentUpdateRequest'>;
export type AgentStatusInput = Schema<'AgentStatusAction'>;
export type AgentPasswordResetResult = Schema<'AgentPasswordResetResponse'>['data'];
export type ProductAuthorization = Schema<'ProductAuthorizationResponse'>['data'];
export type ProductAuthorizationInput = Schema<'ProductAuthorizationAction'>;
export type InviteRotationInput = Schema<'InviteRotationAction'>;
export type InviteRotationResult = Schema<'InviteCodeRotateResponse'>['data'];
export type InviteStatusInput = Schema<'InviteStatusAction'>;
export type AdminAgentCommissionResult = Schema<'AdminAgentCommissionHistoryResponse'>['data'];
export type AdminAgentWalletLedgerResult = Schema<'AdminAgentWalletLedgerResponse'>['data'];

export interface AdminAgentListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'ACTIVE' | 'DISABLED';
  authorizationMode?: 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';
  dateFrom?: string;
  dateTo?: string;
}

export interface AdminAgentCommissionQuery {
  page?: number;
  pageSize?: number;
  positionState?: 'NONE' | 'EXPECTED' | 'CANCELLED' | 'AVAILABLE';
  ledgerType?: 'EXPECTED_CREATED' | 'EXPECTED_REDUCED' | 'EXPECTED_CANCELLED' | 'AVAILABLE_CREDIT' | 'REFUND_DEBIT';
  dateFrom?: string;
  dateTo?: string;
}

export interface AdminAgentWalletLedgerQuery {
  page?: number;
  pageSize?: number;
  ledgerType?:
    | 'EXPECTED_CREATED'
    | 'EXPECTED_REDUCED'
    | 'EXPECTED_CANCELLED'
    | 'AVAILABLE_CREDIT'
    | 'REFUND_DEBIT'
    | 'WITHDRAWAL_FREEZE'
    | 'WITHDRAWAL_RELEASE'
    | 'WITHDRAWAL_PAID';
  dateFrom?: string;
  dateTo?: string;
}

export type CommissionRules = Schema<'CommissionRulesResponse'>['data'];
export type CommissionRuleSkuResult = Schema<'CommissionRuleSkuListResponse'>['data'];
export type CommissionRuleInput = Schema<'CommissionRuleAction'>;
export type CommissionRuleVersion = Schema<'CommissionRuleVersionView'>;
export type CommissionRuleVersionResult = Schema<'CommissionRuleVersionListResponse'>['data'];
export type OrderCommissionExplanation = Schema<'OrderCommissionExplanationResponse'>['data'];

export interface CommissionRuleSkuQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  categoryId?: string;
  source?: 'PLATFORM' | 'CATEGORY' | 'SKU';
}

export interface CommissionRuleVersionQuery {
  page?: number;
  pageSize?: number;
  status?: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  dateFrom?: string;
  dateTo?: string;
}

export type AdminWithdrawal = Schema<'AdminWithdrawalView'>;
export type AdminWithdrawalListResult = Schema<'AdminWithdrawalListResponse'>['data'];
export type PayoutReauthInput = Schema<'PayoutReauthRequest'>;
export type PayoutReauth = Schema<'ReauthResponse'>['data'];
export type PayoutAccountReveal = Schema<'PayoutAccountRevealResponse'>['data'];
export type WithdrawalProofInput = Schema<'ProofFilesRequest'>;
export type MarkPaidInput = Schema<'MarkPaidAction'>;

export interface AdminWithdrawalListQuery {
  page?: number;
  pageSize?: number;
  agentId?: string;
  withdrawalNo?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  dateFrom?: string;
  dateTo?: string;
  minAmount?: string;
  maxAmount?: string;
}

export type AuditLog = Schema<'AuditLogView'>;
export type AuditLogListResult = Schema<'AuditLogListResponse'>['data'];

export interface AuditLogListQuery {
  page?: number;
  pageSize?: number;
  actorId?: string;
  module?: string;
  action?: string;
  resultCode?: string;
  targetType?: string;
  targetId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export type BusinessRules = Schema<'BusinessRuleView'>;
export type BusinessRuleInput = Schema<'BusinessRuleAction'>;
