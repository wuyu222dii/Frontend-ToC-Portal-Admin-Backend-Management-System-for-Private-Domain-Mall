import type {
  AdminAgent,
  AdminAgentCommissionQuery,
  AdminAgentCommissionResult,
  AdminAgentDetail,
  AdminAgentListQuery,
  AdminAgentListResult,
  AdminAgentWalletLedgerQuery,
  AdminAgentWalletLedgerResult,
  AdminCommandResult,
  AgentCreateInput,
  AgentCreateResult,
  AgentPasswordResetResult,
  AgentStatusInput,
  AgentUpdateInput,
  HighRiskPreview,
  InviteRotationInput,
  InviteRotationResult,
  InviteStatusInput,
  ProductAuthorization,
  ProductAuthorizationInput,
  ReasonInput,
} from '../types/admin-b13';
import { adminSessionRequest } from './admin-api';
import {
  decodeAdminAgentCommissionResponse,
  decodeAdminAgentCreateResponse,
  decodeAdminAgentDetailResponse,
  decodeAdminAgentListResponse,
  decodeAdminAgentPasswordResetResponse,
  decodeAdminAgentResponse,
  decodeAdminAgentWalletLedgerResponse,
  decodeAdminCommandResponse,
  decodeAdminHighRiskPreviewResponse,
  decodeAdminInviteRotationResponse,
  decodeAdminProductAuthorizationResponse,
} from './admin-b13-decoders';

export type {
  AdminAgent,
  AdminAgentCommissionQuery,
  AdminAgentCommissionResult,
  AdminAgentDetail,
  AdminAgentListQuery,
  AdminAgentListResult,
  AdminAgentWalletLedgerQuery,
  AdminAgentWalletLedgerResult,
  AdminCommandResult,
  AgentCreateInput,
  AgentCreateResult,
  AgentPasswordResetResult,
  AgentStatusInput,
  AgentUpdateInput,
  HighRiskPreview,
  InviteRotationInput,
  InviteRotationResult,
  InviteStatusInput,
  ProductAuthorization,
  ProductAuthorizationInput,
  ReasonInput,
} from '../types/admin-b13';

const agentsPath = '/admin/agents';

function agentPath(agentId: string): string {
  return `${agentsPath}/${encodeURIComponent(agentId)}`;
}

function versionEtag(version: number): string {
  return `"${version}"`;
}

function addPage(search: URLSearchParams, query: { page?: number; pageSize?: number }): void {
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
}

export function buildAdminAgentListPath(query: AdminAgentListQuery = {}): string {
  const search = new URLSearchParams();
  addPage(search, query);
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.status) search.set('status', query.status);
  if (query.authorizationMode) search.set('authorization_mode', query.authorizationMode);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  return search.size > 0 ? `${agentsPath}?${search.toString()}` : agentsPath;
}

export async function listAdminAgents(
  query: AdminAgentListQuery = {},
  signal?: AbortSignal,
): Promise<AdminAgentListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminAgentListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAgentListResponse(response);
}

export async function createAdminAgent(
  input: AgentCreateInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentCreateResult> {
  const response = await adminSessionRequest<unknown>(agentsPath, {
    body: input,
    expectedStatus: 201,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminAgentCreateResponse(response);
}

export async function getAdminAgent(agentId: string, signal?: AbortSignal): Promise<AdminAgentDetail> {
  const response = await adminSessionRequest<unknown>(agentPath(agentId), { expectedStatus: 200, signal });
  return decodeAdminAgentDetailResponse(response, agentId);
}

export async function updateAdminAgent(
  agentId: string,
  input: AgentUpdateInput,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminAgent> {
  const response = await adminSessionRequest<unknown>(agentPath(agentId), {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
    signal,
  });
  return decodeAdminAgentResponse(response, agentId);
}

export async function previewAdminAgentDisable(
  agentId: string,
  input: AgentStatusInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/status-change-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminAgentDisable(
  agentId: string,
  input: AgentStatusInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminCommandResult> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/status-changes`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminCommandResponse(response, agentId);
}

export async function reactivateAdminAgent(
  agentId: string,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminCommandResult> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/reactivate`, {
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'POST',
    signal,
  });
  return decodeAdminCommandResponse(response, agentId);
}

export async function previewAdminAgentPasswordReset(
  agentId: string,
  input: ReasonInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/password-reset-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminAgentPasswordReset(
  agentId: string,
  input: ReasonInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AgentPasswordResetResult> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/password-resets`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminAgentPasswordResetResponse(response, agentId);
}

export async function getAdminAgentProductAuthorization(
  agentId: string,
  signal?: AbortSignal,
): Promise<ProductAuthorization> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/product-authorization`, {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminProductAuthorizationResponse(response, agentId);
}

export async function updateAdminAgentProductAuthorization(
  agentId: string,
  input: ProductAuthorizationInput,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ProductAuthorization> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/product-authorization`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
    signal,
  });
  return decodeAdminProductAuthorizationResponse(response, agentId);
}

export async function previewAdminAgentInviteRotation(
  agentId: string,
  input: InviteRotationInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/invite-code/rotate-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminAgentInviteRotation(
  agentId: string,
  input: InviteRotationInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<InviteRotationResult> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/invite-code/rotate`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminInviteRotationResponse(response, agentId);
}

export async function previewAdminAgentInviteStatus(
  agentId: string,
  input: InviteStatusInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/invite-code/status-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminAgentInviteStatus(
  agentId: string,
  input: InviteStatusInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminCommandResult> {
  const response = await adminSessionRequest<unknown>(`${agentPath(agentId)}/invite-code`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'PATCH',
    signal,
  });
  return decodeAdminCommandResponse(response);
}

export function buildAdminAgentCommissionPath(
  agentId: string,
  query: AdminAgentCommissionQuery = {},
): string {
  const search = new URLSearchParams();
  addPage(search, query);
  if (query.positionState) search.set('position_state', query.positionState);
  if (query.ledgerType) search.set('ledger_type', query.ledgerType);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  const path = `${agentPath(agentId)}/commissions`;
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

export async function listAdminAgentCommissions(
  agentId: string,
  query: AdminAgentCommissionQuery = {},
  signal?: AbortSignal,
): Promise<AdminAgentCommissionResult> {
  const response = await adminSessionRequest<unknown>(buildAdminAgentCommissionPath(agentId, query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAgentCommissionResponse(response, agentId);
}

export function buildAdminAgentWalletLedgerPath(
  agentId: string,
  query: AdminAgentWalletLedgerQuery = {},
): string {
  const search = new URLSearchParams();
  addPage(search, query);
  if (query.ledgerType) search.set('ledger_type', query.ledgerType);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  const path = `${agentPath(agentId)}/wallet-ledger`;
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

export async function listAdminAgentWalletLedger(
  agentId: string,
  query: AdminAgentWalletLedgerQuery = {},
  signal?: AbortSignal,
): Promise<AdminAgentWalletLedgerResult> {
  const response = await adminSessionRequest<unknown>(buildAdminAgentWalletLedgerPath(agentId, query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAgentWalletLedgerResponse(response, agentId);
}
