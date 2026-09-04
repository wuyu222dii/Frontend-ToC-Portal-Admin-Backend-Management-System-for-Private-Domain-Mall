import { computed, reactive, ref } from 'vue';

import type { AgentCurrent, AgentSession, RestrictedAgentSession } from '../types/agent';

const REMEMBERED_LOGIN_KEY = 'qingxu.agent.remembered_login';
const sessionLineage = new Map<string, string>();

const state = reactive<{
  session: AgentSession | null;
  restrictedSession: RestrictedAgentSession | null;
  current: AgentCurrent | null;
}>({
  session: null,
  restrictedSession: null,
  current: null,
});

function rememberedLoginValue(): string {
  try {
    return localStorage.getItem(REMEMBERED_LOGIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function sameSession(left: AgentSession | null, right: AgentSession): boolean {
  return (
    left?.account_id === right.account_id &&
    left.session_id === right.session_id &&
    left.access_token === right.access_token &&
    left.refresh_token === right.refresh_token
  );
}

function sameRestrictedSession(
  left: RestrictedAgentSession | null,
  right: RestrictedAgentSession,
): boolean {
  return (
    left?.account_id === right.account_id &&
    left.session_id === right.session_id &&
    left.access_token === right.access_token
  );
}

function sessionIdentity(session: AgentSession): string {
  return `${session.account_id}:${session.session_id}`;
}

function clear(): void {
  state.session = null;
  state.restrictedSession = null;
  state.current = null;
  sessionLineage.clear();
}

const rememberedLogin = ref(rememberedLoginValue());

export const agentAuthSession = {
  state,
  hasSession: computed(() => state.session !== null),
  needsPasswordChange: computed(() => state.restrictedSession !== null),
  rememberedLogin,
  acceptSession(session: AgentSession): void {
    if (
      session.role !== 'AGENT_ADMIN' ||
      session.mfa_required !== false ||
      session.assurance !== 'PASSWORD' ||
      session.restriction !== 'NONE'
    ) {
      clear();
      throw new TypeError('The server returned an invalid Agent session');
    }
    sessionLineage.clear();
    state.session = session;
    state.restrictedSession = null;
    state.current = null;
  },
  acceptRestricted(session: RestrictedAgentSession): void {
    const actions = new Set(session.allowed_actions);
    if (
      session.role !== 'AGENT_ADMIN' ||
      session.mfa_required !== false ||
      session.assurance !== 'PASSWORD' ||
      session.restriction !== 'CHANGE_PASSWORD_ONLY' ||
      session.must_change_password !== true ||
      session.next_action !== 'CHANGE_PASSWORD' ||
      actions.size !== 2 ||
      !actions.has('CHANGE_TEMPORARY_PASSWORD') ||
      !actions.has('LOGOUT') ||
      'refresh_token' in session
    ) {
      clear();
      throw new TypeError('The server returned an invalid restricted Agent session');
    }
    sessionLineage.clear();
    state.session = null;
    state.restrictedSession = session;
    state.current = null;
  },
  acceptCurrent(current: AgentCurrent): void {
    state.current = current;
  },
  replaceSession(previous: AgentSession, next: AgentSession): boolean {
    if (!sameSession(state.session, previous)) return false;
    sessionLineage.set(sessionIdentity(next), sessionIdentity(previous));
    state.session = next;
    return true;
  },
  descendsFrom(previous: AgentSession): boolean {
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
  },
  matchesSession(session: AgentSession): boolean {
    return sameSession(state.session, session);
  },
  matchesRestrictedSession(session: RestrictedAgentSession): boolean {
    return sameRestrictedSession(state.restrictedSession, session);
  },
  clearSession(session: AgentSession): boolean {
    if (!sameSession(state.session, session)) return false;
    clear();
    return true;
  },
  clearRestrictedSession(session: RestrictedAgentSession): boolean {
    if (!sameRestrictedSession(state.restrictedSession, session)) return false;
    clear();
    return true;
  },
  clear,
  rememberLogin(loginName: string, remember: boolean): void {
    rememberedLogin.value = remember ? loginName : '';
    try {
      if (remember) localStorage.setItem(REMEMBERED_LOGIN_KEY, loginName);
      else localStorage.removeItem(REMEMBERED_LOGIN_KEY);
    } catch {
      // Storage may be disabled. Authentication remains memory-only.
    }
  },
  forgetRememberedLogin(): void {
    rememberedLogin.value = '';
    try {
      localStorage.removeItem(REMEMBERED_LOGIN_KEY);
    } catch {
      // Storage may be disabled.
    }
  },
};
