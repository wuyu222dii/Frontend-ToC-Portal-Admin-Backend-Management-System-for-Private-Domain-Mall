import type { AuditLogListQuery, AuditLogListResult } from '../types/admin-b13';
import { adminSessionRequest } from './admin-api';
import { decodeAdminAuditLogListResponse } from './admin-b13-decoders';

export type { AuditLog, AuditLogListQuery, AuditLogListResult } from '../types/admin-b13';

const auditPath = '/admin/audit-logs';

export function buildAdminAuditLogListPath(query: AuditLogListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.actorId) search.set('actor_id', query.actorId);
  if (query.module) search.set('module', query.module);
  if (query.action) search.set('action', query.action);
  if (query.resultCode) search.set('result_code', query.resultCode);
  if (query.targetType) search.set('target_type', query.targetType);
  if (query.targetId) search.set('target_id', query.targetId);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  return search.size > 0 ? `${auditPath}?${search.toString()}` : auditPath;
}

export async function listAdminAuditLogs(
  query: AuditLogListQuery = {},
  signal?: AbortSignal,
): Promise<AuditLogListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminAuditLogListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAuditLogListResponse(response);
}
