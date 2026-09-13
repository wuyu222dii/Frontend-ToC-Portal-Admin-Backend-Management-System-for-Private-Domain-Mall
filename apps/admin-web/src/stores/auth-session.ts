import { computed, reactive } from 'vue';

import type {
  AdminAccountCurrent,
  AdminAuthSession,
  AuthPreauthData,
  TotpEnrollData,
} from '../types/auth';

const REMEMBERED_LOGIN_KEY = 'qingxu.admin.remembered_login';
const sessionLineage = new Map<string, string>();

interface AuthMemoryState {
  preauth: AuthPreauthData | null;
  session: AdminAuthSession | null;
  current: AdminAccountCurrent | null;
  enrollment: TotpEnrollData | null;
  recoveryCodes: string[];
}

const state = reactive<AuthMemoryState>({
  preauth: null,
  session: null,
  current: null,
  enrollment: null,
  recoveryCodes: [],
});

function readRememberedLogin(): string {
  try {
    return localStorage.getItem(REMEMBERED_LOGIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberLogin(loginName: string, remember: boolean): void {
  try {
    if (remember) localStorage.setItem(REMEMBERED_LOGIN_KEY, loginName);
    else localStorage.removeItem(REMEMBERED_LOGIN_KEY);
  } catch {
    // Authentication must not depend on storage availability.
  }
}

function sameSession(left: AdminAuthSession | null, right: AdminAuthSession): boolean {
  return (
    left?.account_id === right.account_id &&
    left.session_id === right.session_id &&
    left.access_token === right.access_token &&
    left.refresh_token === right.refresh_token
  );
}

function sessionIdentity(session: AdminAuthSession): string {
  return `${session.account_id}:${session.session_id}`;
}

function isValidAdminSession(session: AdminAuthSession): boolean {
  return (
    session.role === 'SUPER_ADMIN' &&
    session.assurance === 'MFA' &&
    session.restriction === 'NONE' &&
    session.mfa_required === false
  );
}

function clearOneTimeValues(): void {
  state.enrollment = null;
  state.recoveryCodes.splice(0);
}

function clearPreauth(): void {
  state.preauth = null;
  state.enrollment = null;
}

function clearSession(): void {
  state.session = null;
  state.current = null;
  sessionLineage.clear();
  clearPreauth();
  clearOneTimeValues();
}

function acceptPreauth(preauth: AuthPreauthData): void {
  clearSession();
  state.preauth = preauth;
}

function acceptSession(session: AdminAuthSession): void {
  if (!isValidAdminSession(session)) {
    clearSession();
    throw new TypeError('The server returned an invalid administrator session');
  }
  sessionLineage.clear();
  state.session = session;
  state.preauth = null;
  state.enrollment = null;
}

function replaceSession(previous: AdminAuthSession, next: AdminAuthSession): boolean {
  if (!sameSession(state.session, previous) || !isValidAdminSession(next)) return false;
  sessionLineage.set(sessionIdentity(next), sessionIdentity(previous));
  state.session = next;
  return true;
}

function descendsFrom(previous: AdminAuthSession): boolean {
  const current = state.session;
  if (!current || current.account_id !== previous.account_id) return false;
  const ancestor = sessionIdentity(previous);
  let cursor = sessionIdentity(current);
  for (let depth = 0; depth < 20; depth += 1) {
    if (cursor === ancestor) return true;
    const parent = sessionLineage.get(cursor);
    if (parent === undefined) return false;
    cursor = parent;
  }
  return false;
}

function matchesSession(session: AdminAuthSession): boolean {
  return sameSession(state.session, session);
}

function setRecoveryCodes(codes: readonly string[]): void {
  state.recoveryCodes.splice(0, state.recoveryCodes.length, ...codes);
}

export const authSession = {
  state,
  hasSession: computed(() => state.session !== null),
  preauthAction: computed(() => state.preauth?.next_action ?? null),
  readRememberedLogin,
  rememberLogin,
  acceptPreauth,
  acceptSession,
  replaceSession,
  descendsFrom,
  matchesSession,
  clearPreauth,
  clearSession,
  clearOneTimeValues,
  setRecoveryCodes,
};
