import { ApplicationError } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface AdminBusinessRuleChanges {
  aftersaleWindowDays?: number;
  minimumWithdrawalAmount?: string;
}

export interface AdminBusinessRuleAction {
  changes: AdminBusinessRuleChanges;
  reason: string;
}

export interface AdminBusinessRuleConfirmation extends AdminBusinessRuleAction {
  confirmationHash: string;
  previewToken: string;
}

const MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const SHA256 = /^[a-f0-9]{64}$/;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function record(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`${label} must be an object`);
  }
  return value as PlainRecord;
}

function exact(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): PlainRecord {
  const output = record(value, label);
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.hasOwn(output, field)) ||
    Object.keys(output).some((field) => !allowed.has(field))) return invalid(`${label} fields are invalid`);
  return output;
}

function reason(value: unknown): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid('reason is invalid');
  const normalized = value.trim();
  if (Array.from(normalized).length < 2 || Array.from(normalized).length > 500) {
    return invalid('reason is invalid');
  }
  return normalized;
}

function changes(value: unknown): AdminBusinessRuleChanges {
  const input = exact(value, 'changes', [], ['minimum_withdrawal_amount', 'aftersale_window_days']);
  if (Object.keys(input).length === 0) return invalid('changes must not be empty');
  const output: AdminBusinessRuleChanges = {};
  if (input.minimum_withdrawal_amount !== undefined) {
    if (typeof input.minimum_withdrawal_amount !== 'string' || !MONEY.test(input.minimum_withdrawal_amount)) {
      return invalid('minimum_withdrawal_amount is invalid');
    }
    output.minimumWithdrawalAmount = input.minimum_withdrawal_amount;
  }
  if (input.aftersale_window_days !== undefined) {
    if (typeof input.aftersale_window_days !== 'number' || !Number.isSafeInteger(input.aftersale_window_days) ||
      input.aftersale_window_days < 1 || input.aftersale_window_days > 365) {
      return invalid('aftersale_window_days is invalid');
    }
    output.aftersaleWindowDays = input.aftersale_window_days;
  }
  return output;
}

function action(value: unknown, confirmation: boolean): AdminBusinessRuleAction | AdminBusinessRuleConfirmation {
  const fields = confirmation ? ['reason', 'changes', 'preview_token', 'confirmation_hash'] : ['reason', 'changes'];
  const body = exact(value, 'Request body', fields);
  const output: AdminBusinessRuleAction = { changes: changes(body.changes), reason: reason(body.reason) };
  if (!confirmation) return output;
  if (typeof body.preview_token !== 'string' || body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !SHA256.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return { ...output, confirmationHash: body.confirmation_hash, previewToken: body.preview_token };
}

export function parseAdminBusinessRuleAction(value: unknown): AdminBusinessRuleAction {
  return action(value, false) as AdminBusinessRuleAction;
}

export function parseAdminBusinessRuleConfirmation(value: unknown): AdminBusinessRuleConfirmation {
  return action(value, true) as AdminBusinessRuleConfirmation;
}

export function parseAdminSettingsEmptyQuery(value: unknown): void {
  if (Object.keys(record(value, 'Query')).length > 0) return invalid('Query fields are invalid');
}
