import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export type AgentStatus = 'ACTIVE' | 'DISABLED';
export type ProductAuthorizationMode = 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';

export interface AdminAgentListInput {
  authorizationMode?: ProductAuthorizationMode;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  keyword?: string;
  page: number;
  pageSize: number;
  status?: AgentStatus;
}

export interface AdminAgentCreateInput {
  contactName: string | null;
  contactPhone: string | null;
  loginName: string;
  name: string;
  productAuthorizationMode: ProductAuthorizationMode;
}

export interface AdminAgentUpdateInput {
  contactName?: string | null;
  contactPhone?: string | null;
  name?: string;
}

export interface AgentStatusActionInput {
  reason: string;
  targetStatus: 'DISABLED';
}

export interface ReasonActionInput {
  reason: string;
}

export interface HighRiskConfirmationInput {
  confirmationHash: string;
  previewToken: string;
}

const AUTHORIZATION_MODES = new Set<ProductAuthorizationMode>([
  'ALL_ACTIVE_PRODUCTS',
  'CUSTOM_WHITELIST',
]);
const AGENT_STATUSES = new Set<AgentStatus>(['ACTIVE', 'DISABLED']);
const LOGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function closedBody(value: unknown, required: readonly string[], optional: readonly string[] = []): PlainRecord {
  const body = plainRecord(value, 'Request body');
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.hasOwn(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function boundedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function nullableContactName(value: unknown, required: boolean): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid('contact_name is invalid');
  const normalized = value.trim();
  if (Array.from(normalized).length > 80) return invalid('contact_name is invalid');
  if (required || normalized.length > 0) return normalized.length === 0 ? null : normalized;
  return null;
}

function nullableContactPhone(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid('contact_phone is invalid');
  const normalized = value.trim();
  if (!/^[0-9]{11}$/.test(normalized)) return invalid('contact_phone is invalid');
  return normalized;
}

function positiveQueryInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function shanghaiBoundary(value: unknown, field: string, nextDay: boolean): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(date.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

function reason(value: unknown): string {
  return boundedText(value, 'reason', 2, 500);
}

function confirmationFields(body: PlainRecord): HighRiskConfirmationInput {
  if (typeof body.preview_token !== 'string' || body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !SHA256.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return { confirmationHash: body.confirmation_hash, previewToken: body.preview_token };
}

export function parseAdminAgentId(value: string): string {
  if (!isValidUlid(value)) return invalid('agent_id is invalid');
  return value;
}

export function parseAdminAgentListQuery(value: unknown): AdminAgentListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['authorization_mode', 'date_from', 'date_to', 'keyword', 'page', 'page_size', 'status']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminAgentListInput = {
    page: positiveQueryInteger(query.page, 1, 2_147_483_647, 'page'),
    pageSize: positiveQueryInteger(query.page_size, 20, 100, 'page_size'),
  };
  if (query.keyword !== undefined) output.keyword = boundedText(query.keyword, 'keyword', 1, 120);
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !AGENT_STATUSES.has(query.status as AgentStatus)) {
      return invalid('status is invalid');
    }
    output.status = query.status as AgentStatus;
  }
  if (query.authorization_mode !== undefined) {
    if (typeof query.authorization_mode !== 'string' ||
      !AUTHORIZATION_MODES.has(query.authorization_mode as ProductAuthorizationMode)) {
      return invalid('authorization_mode is invalid');
    }
    output.authorizationMode = query.authorization_mode as ProductAuthorizationMode;
  }
  if (query.date_from !== undefined) output.createdAtFrom = shanghaiBoundary(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) output.createdAtToExclusive = shanghaiBoundary(query.date_to, 'date_to', true);
  if (output.createdAtFrom && output.createdAtToExclusive &&
    output.createdAtFrom.getTime() >= output.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return output;
}

export function parseAdminAgentCreateBody(value: unknown): AdminAgentCreateInput {
  const body = closedBody(
    value,
    ['login_name', 'name', 'contact_name', 'product_authorization_mode'],
    ['contact_phone'],
  );
  if (typeof body.login_name !== 'string' || !LOGIN_NAME.test(body.login_name)) {
    return invalid('login_name is invalid');
  }
  if (typeof body.contact_name !== 'string') {
    return invalid('contact_name is invalid');
  }
  if (typeof body.product_authorization_mode !== 'string' ||
    !AUTHORIZATION_MODES.has(body.product_authorization_mode as ProductAuthorizationMode)) {
    return invalid('product_authorization_mode is invalid');
  }
  return {
    contactName: nullableContactName(body.contact_name, true),
    contactPhone: body.contact_phone === undefined ? null : nullableContactPhone(body.contact_phone),
    loginName: body.login_name.toLowerCase(),
    name: boundedText(body.name, 'name', 1, 120),
    productAuthorizationMode: body.product_authorization_mode as ProductAuthorizationMode,
  };
}

export function parseAdminAgentUpdateBody(value: unknown): AdminAgentUpdateInput {
  const body = closedBody(value, [], ['name', 'contact_name', 'contact_phone']);
  if (Object.keys(body).length === 0) return invalid('Request body must contain at least one field');
  const output: AdminAgentUpdateInput = {};
  if (body.name !== undefined) output.name = boundedText(body.name, 'name', 1, 120);
  if (body.contact_name !== undefined) output.contactName = nullableContactName(body.contact_name, false);
  if (body.contact_phone !== undefined) output.contactPhone = nullableContactPhone(body.contact_phone);
  return output;
}

export function parseAgentStatusActionBody(value: unknown): AgentStatusActionInput {
  const body = closedBody(value, ['target_status', 'reason']);
  if (body.target_status !== 'DISABLED') return invalid('target_status is invalid');
  return { reason: reason(body.reason), targetStatus: 'DISABLED' };
}

export function parseAgentStatusConfirmationBody(
  value: unknown,
): AgentStatusActionInput & HighRiskConfirmationInput {
  const body = closedBody(value, ['target_status', 'reason', 'preview_token', 'confirmation_hash']);
  if (body.target_status !== 'DISABLED') return invalid('target_status is invalid');
  return { ...confirmationFields(body), reason: reason(body.reason), targetStatus: 'DISABLED' };
}

export function parseReasonActionBody(value: unknown): ReasonActionInput {
  const body = closedBody(value, ['reason']);
  return { reason: reason(body.reason) };
}

export function parseReasonConfirmationBody(value: unknown): ReasonActionInput & HighRiskConfirmationInput {
  const body = closedBody(value, ['reason', 'preview_token', 'confirmation_hash']);
  return { ...confirmationFields(body), reason: reason(body.reason) };
}

export function parseAdminAgentEmptyQuery(value: unknown): void {
  const query = plainRecord(value, 'Query');
  if (Object.keys(query).length !== 0) return invalid('Query fields are invalid');
}

export function parseAdminAgentEmptyBody(value: unknown): void {
  if (value === undefined) return;
  const body = plainRecord(value, 'Request body');
  if (Object.keys(body).length !== 0) return invalid('Request body is not supported');
}
