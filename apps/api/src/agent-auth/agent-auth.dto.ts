import { ApplicationError } from '@qingxu/platform-core';

export interface AgentLoginInput {
  loginName: string;
  password: string;
}

export interface AgentRefreshInput {
  refreshToken: string;
}

export interface AgentChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

type PlainBody = Record<string, unknown>;

function objectWithFields(value: unknown, required: readonly string[]): PlainBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body must be an object');
  }
  const body = value as PlainBody;
  if (required.some((field) => !(field in body)) ||
    Object.keys(body).some((field) => !required.includes(field))) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body fields are invalid');
  }
  return body;
}

function stringField(body: PlainBody, field: string, minimum: number, maximum: number): string {
  const value = body[field];
  const length = typeof value === 'string' ? Array.from(value).length : -1;
  if (typeof value !== 'string' || length < minimum || length > maximum) {
    throw new ApplicationError('INVALID_ARGUMENT', `${field} is invalid`);
  }
  return value;
}

export function parseAgentLoginBody(value: unknown): AgentLoginInput {
  const body = objectWithFields(value, ['login_name', 'password']);
  const loginName = stringField(body, 'login_name', 1, 80);
  return {
    loginName: loginName.toLowerCase(),
    password: stringField(body, 'password', 8, 128),
  };
}

export function parseAgentRefreshBody(value: unknown): AgentRefreshInput {
  const body = objectWithFields(value, ['refresh_token']);
  return { refreshToken: stringField(body, 'refresh_token', 20, 512) };
}

export function parseAgentChangePasswordBody(value: unknown): AgentChangePasswordInput {
  const body = objectWithFields(value, ['current_password', 'new_password']);
  return {
    currentPassword: stringField(body, 'current_password', 8, 128),
    newPassword: stringField(body, 'new_password', 12, 128),
  };
}

export function assertNoAgentAuthQuery(value: unknown): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.keys(value).length === 0) {
    return;
  }
  throw new ApplicationError('INVALID_ARGUMENT', 'Agent authentication query parameters are not supported');
}

export function assertNoAgentAuthBody(value: unknown): void {
  if (value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Object.keys(value).length === 0)) {
    return;
  }
  throw new ApplicationError('INVALID_ARGUMENT', 'Request body is not supported');
}
