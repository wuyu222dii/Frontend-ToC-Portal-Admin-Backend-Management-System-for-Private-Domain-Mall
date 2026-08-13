import { computed, reactive } from 'vue';

import type {
  AdminAccountCurrent,
  AdminAuthSession,
  AuthPreauthData,
  TotpEnrollData,
} from '../types/auth';

const REMEMBERED_LOGIN_KEY = 'qingxu.admin.remembered_login';

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
  clearPreauth();
  clearOneTimeValues();
}

function acceptPreauth(preauth: AuthPreauthData): void {
  clearSession();
  state.preauth = preauth;
}

function acceptSession(session: AdminAuthSession): void {
  if (session.role !== 'SUPER_ADMIN' || session.assurance !== 'MFA' || session.restriction !== 'NONE') {
    clearSession();
    throw new TypeError('The server returned an invalid administrator session');
  }
  state.session = session;
  state.preauth = null;
  state.enrollment = null;
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
  clearPreauth,
  clearSession,
  clearOneTimeValues,
  setRecoveryCodes,
};

