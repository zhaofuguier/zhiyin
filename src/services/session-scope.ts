import {
  captureSessionContinuity,
  isSessionContinuityCurrent,
  type SessionContinuitySnapshot
} from './session';

export const LOGIN_REQUIRED_MESSAGE = '登录后使用';

export interface SessionScope {
  readonly authenticated: boolean;
}

const scopeContinuity = new WeakMap<SessionScope, SessionContinuitySnapshot>();

export function captureSessionScope(): SessionScope {
  const continuity = captureSessionContinuity();
  const scope = Object.freeze({ authenticated: Boolean(continuity.token) });
  scopeContinuity.set(scope, continuity);
  return scope;
}

export function isSessionScopeCurrent(scope: SessionScope): boolean {
  const continuity = scopeContinuity.get(scope);
  return Boolean(continuity && isSessionContinuityCurrent(continuity));
}

export function sessionScopeWriteKey(scope: SessionScope): string | undefined {
  const continuity = scopeContinuity.get(scope);
  if (!continuity?.principalId) return undefined;
  return `${continuity.generation}:${continuity.principalId}`;
}

export function promptLoginForAction(action: string): false {
  uni.showModal({
    title: LOGIN_REQUIRED_MESSAGE,
    content: `${action}需要登录。`,
    confirmText: '去登录',
    cancelText: '暂不',
    success: (result) => {
      if (result.confirm) uni.navigateTo({ url: '/pages/privacy/index' });
    }
  });
  return false;
}

export function requireSessionForAction(action: string): boolean {
  return captureSessionContinuity().token ? true : promptLoginForAction(action);
}
