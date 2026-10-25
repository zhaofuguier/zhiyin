import { API_BASE_URL } from './config';

const SESSION_TOKEN_KEY = 'zhiyin.sessionToken';
const SESSION_EXPIRES_AT_KEY = 'zhiyin.sessionExpiresAt';
const SESSION_CONSENT_KEY = 'zhiyin.sessionConsent';
const SESSION_PRINCIPAL_KEY = 'zhiyin.sessionPrincipalId';
const SESSION_TIMEOUT_MS = 8000;
export const SESSION_MAINTENANCE_MESSAGE = '系统维护中，请稍后重试';
export const SESSION_LOGIN_RETRY_MESSAGE = '\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55';
export const SESSION_LOGIN_UNAVAILABLE_MESSAGE = '\u767b\u5f55\u670d\u52a1\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5';

export type SessionPlatform = 'wechat' | 'douyin';
export type LoginAgeBand = 'adult' | 'minor-14-17' | 'under-14';
export interface SessionConsent {
  consent: true;
  privacyVersion: string;
  termsVersion: string;
  minorsVersion: string;
  ageBand: LoginAgeBand;
}

interface SessionLoginResponse {
  token: string;
  expiresAt: string;
  user: unknown;
}

interface RenewalFlight {
  generation: number;
  previousToken: string;
  promise: Promise<SessionLoginResponse>;
}

let sessionGeneration = 0;
let renewalFlight: RenewalFlight | undefined;
const renewedTokenParents = new Map<string, { generation: number; previousToken: string; principalId: string }>();

export class SessionLoginError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SessionLoginError';
  }
}

export function getSessionToken(): string | undefined {
  const token = uni.getStorageSync(SESSION_TOKEN_KEY);
  return typeof token === 'string' && token ? token : undefined;
}

export function getSessionPrincipalId(): string | undefined {
  const principalId = uni.getStorageSync(SESSION_PRINCIPAL_KEY);
  return typeof principalId === 'string' && principalId ? principalId : undefined;
}

export interface SessionContinuitySnapshot {
  readonly generation: number;
  readonly token: string | undefined;
  readonly principalId: string | undefined;
}

export function captureSessionContinuity(): SessionContinuitySnapshot {
  return Object.freeze({
    generation: sessionGeneration,
    token: getSessionToken(),
    principalId: getSessionPrincipalId()
  });
}

export function isSessionContinuityCurrent(snapshot: SessionContinuitySnapshot): boolean {
  if (snapshot.generation !== sessionGeneration) return false;
  const currentToken = getSessionToken();
  const currentPrincipalId = getSessionPrincipalId();
  if (!snapshot.token || !currentToken || snapshot.principalId !== currentPrincipalId) return false;
  if (snapshot.token === currentToken) return true;
  return hasRenewalLineage(snapshot.token, currentToken, snapshot.generation, currentPrincipalId);
}

export function clearSession(): void {
  invalidateSessionContinuity('logout');
  uni.removeStorageSync(SESSION_TOKEN_KEY);
  uni.removeStorageSync(SESSION_EXPIRES_AT_KEY);
  uni.removeStorageSync(SESSION_CONSENT_KEY);
  uni.removeStorageSync(SESSION_PRINCIPAL_KEY);
}

export async function establishSession<T>(consent: SessionConsent): Promise<T> {
  if (!API_BASE_URL) throw new SessionLoginError('SESSION_API_UNAVAILABLE');
  assertSessionConsent(consent);
  if (consent.ageBand === 'under-14') {
    throw new SessionLoginError('UNDER_14_ACCOUNT_NOT_AVAILABLE');
  }
  const generation = beginExplicitSessionChange();
  const platform = runtimePlatform();
  const loginCode = await obtainLoginCode(platform);
  const response = await exchangeLoginCode(platform, loginCode, consent);
  if (generation !== sessionGeneration) throw new SessionLoginError('USER_SESSION_CHANGED');
  const principalId = requireResponsePrincipalId(response.user);
  commitSession(response, principalId, {
    privacyVersion: consent.privacyVersion,
    termsVersion: consent.termsVersion,
    minorsVersion: consent.minorsVersion,
    ageBand: consent.ageBand
  });
  return response.user as T;
}

export async function logoutSession(): Promise<void> {
  const token = getSessionToken();
  if (!token || !API_BASE_URL) return;
  const continuity = captureSessionContinuity();
  await new Promise<void>((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}/api/auth/session/logout`,
      method: 'POST',
      header: { Authorization: `Bearer ${token}` },
      timeout: SESSION_TIMEOUT_MS,
      success: (result) => {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          if (isSessionContinuityCurrent(continuity)) clearSession();
          resolve();
          return;
        }
        if (result.statusCode === 503 && errorCode(result.data) === 'WRITE_FROZEN') {
          reject(maintenanceError());
          return;
        }        if (result.statusCode === 401) {
          reject(loginRetryError());
          return;
        }
        if (result.statusCode === 503) {
          reject(loginUnavailableError());
          return;
        }
        reject(new SessionLoginError('SESSION_LOGOUT_FAILED'));
      },
      fail: () => reject(new SessionLoginError('SESSION_LOGOUT_UNAVAILABLE'))
    });
  });
}
export async function renewSession<T>(): Promise<T> {
  const previousToken = getSessionToken();
  if (!previousToken) throw new SessionLoginError('USER_CONSENT_REQUIRED');
  const principalId = getSessionPrincipalId();
  if (!principalId) throw new SessionLoginError('SESSION_IDENTITY_CONTINUITY_UNVERIFIED');
  const generation = sessionGeneration;
  if (renewalFlight?.generation === generation && renewalFlight.previousToken === previousToken) {
    return (await renewalFlight.promise).user as T;
  }
  const promise = renewSessionToken(previousToken, principalId, generation);
  renewalFlight = { generation, previousToken, promise };
  try {
    return (await promise).user as T;
  } finally {
    if (renewalFlight?.promise === promise) renewalFlight = undefined;
  }
}

export async function recoverSessionAfterUnauthorized(previousToken: string): Promise<string> {
  const currentToken = getSessionToken();
  if (!currentToken) throw new SessionLoginError('USER_CONSENT_REQUIRED');
  if (currentToken !== previousToken) {
    const snapshot = Object.freeze({
      generation: sessionGeneration,
      token: previousToken,
      principalId: getSessionPrincipalId()
    });
    if (isSessionContinuityCurrent(snapshot)) return currentToken;
    throw new SessionLoginError('USER_SESSION_CHANGED');
  }
  await renewSession<unknown>();
  const renewedToken = getSessionToken();
  if (!renewedToken || renewedToken === previousToken) throw new SessionLoginError('SESSION_EXCHANGE_FAILED');
  return renewedToken;
}

export async function obtainDeletionLoginCode(): Promise<string> {
  return obtainLoginCode(runtimePlatform());
}

export function currentRuntimePlatform(): SessionPlatform | undefined {
  // #ifdef MP-TOUTIAO
  return 'douyin';
  // #endif

  // #ifdef MP-WEIXIN
  return 'wechat';
  // #endif

  return undefined;
}

function runtimePlatform(): SessionPlatform {
  const platform = currentRuntimePlatform();
  if (platform) return platform;
  throw new SessionLoginError('SESSION_PLATFORM_UNSUPPORTED');
}

async function obtainLoginCode(platform: SessionPlatform): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: (platform === 'douyin' ? 'toutiao' : 'weixin') as UniApp.LoginOptions['provider'],
      success: (result) => {
        const code = typeof result.code === 'string' ? result.code.trim() : '';
        if (code) resolve(code);
        else reject(new SessionLoginError('SESSION_LOGIN_CODE_MISSING'));
      },
      fail: () => reject(new SessionLoginError('SESSION_PLATFORM_LOGIN_FAILED'))
    });
  });
}

async function exchangeLoginCode(platform: SessionPlatform, loginCode: string, consent: SessionConsent): Promise<SessionLoginResponse> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}/api/auth/session/login`,
      method: 'POST',
      data: {
        provider: platform,
        loginCode,
        consent: consent.consent,
        privacyVersion: consent.privacyVersion,
        termsVersion: consent.termsVersion,
        minorsVersion: consent.minorsVersion,
        ageBand: consent.ageBand
      },
      timeout: SESSION_TIMEOUT_MS,
      success: (result) => {
        const response = result.data as Partial<SessionLoginResponse> | undefined;
        if (result.statusCode === 503 && errorCode(result.data) === 'WRITE_FROZEN') {
          reject(maintenanceError());
          return;
        }        if (result.statusCode === 401) {
          reject(loginRetryError());
          return;
        }
        if (result.statusCode === 503) {
          reject(loginUnavailableError());
          return;
        }
        if (result.statusCode < 200 || result.statusCode >= 300 ||
            typeof response?.token !== 'string' || !response.token ||
            typeof response.expiresAt !== 'string' || !response.user) {
          reject(loginRetryError());
          return;
        }
        resolve(response as SessionLoginResponse);
      },
      fail: () => reject(loginUnavailableError())
    });
  });
}

function storedSessionConsent(): Omit<SessionConsent, 'consent'> | undefined {
  const value = uni.getStorageSync(SESSION_CONSENT_KEY) as Partial<SessionConsent> | undefined;
  if (!value || typeof value.privacyVersion !== 'string' || typeof value.termsVersion !== 'string' ||
      typeof value.minorsVersion !== 'string' ||
      !['adult', 'minor-14-17'].includes(String(value.ageBand))) return undefined;
  return { privacyVersion: value.privacyVersion, termsVersion: value.termsVersion,
    minorsVersion: value.minorsVersion, ageBand: value.ageBand as 'adult' | 'minor-14-17' };
}

async function renewSessionToken(
  previousToken: string,
  principalId: string,
  generation: number
): Promise<SessionLoginResponse> {
  const consent = storedSessionConsent();
  if (!consent) throw new SessionLoginError('USER_CONSENT_REQUIRED');
  const platform = runtimePlatform();
  const loginCode = await obtainLoginCode(platform);
  const response = await exchangeLoginCode(platform, loginCode, { consent: true, ...consent });
  const renewedPrincipalId = requireResponsePrincipalId(response.user);
  if (renewedPrincipalId !== principalId) throw new SessionLoginError('SESSION_IDENTITY_CHANGED');
  if (generation !== sessionGeneration || getSessionToken() !== previousToken || getSessionPrincipalId() !== principalId) {
    throw new SessionLoginError('USER_SESSION_CHANGED');
  }
  uni.setStorageSync(SESSION_TOKEN_KEY, response.token);
  uni.setStorageSync(SESSION_EXPIRES_AT_KEY, response.expiresAt);
  renewedTokenParents.set(response.token, { generation, previousToken, principalId });
  return response;
}

function commitSession(
  response: SessionLoginResponse,
  principalId: string,
  consent: Omit<SessionConsent, 'consent'>
): void {
  uni.setStorageSync(SESSION_TOKEN_KEY, response.token);
  uni.setStorageSync(SESSION_EXPIRES_AT_KEY, response.expiresAt);
  uni.setStorageSync(SESSION_PRINCIPAL_KEY, principalId);
  uni.setStorageSync(SESSION_CONSENT_KEY, consent);
}

function requireResponsePrincipalId(user: unknown): string {
  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new SessionLoginError('SESSION_RESPONSE_INVALID');
  const id = (user as { id?: unknown }).id;
  if (typeof id !== 'string' || !id.trim()) throw new SessionLoginError('SESSION_RESPONSE_INVALID');
  return id;
}

function beginExplicitSessionChange(): number {
  invalidateSessionContinuity('explicit-login');
  return sessionGeneration;
}

function invalidateSessionContinuity(reason: 'explicit-login' | 'logout'): void {
  const hadPrincipal = Boolean(getSessionPrincipalId());
  sessionGeneration += 1;
  renewalFlight = undefined;
  renewedTokenParents.clear();
  uni.$emit('zhiyin:session-invalidated', { reason, hadPrincipal });
}

function hasRenewalLineage(
  originalToken: string,
  currentToken: string,
  generation: number,
  principalId: string | undefined
): boolean {
  if (!principalId) return false;
  const visited = new Set<string>();
  let token = currentToken;
  while (!visited.has(token)) {
    if (token === originalToken) return true;
    visited.add(token);
    const parent = renewedTokenParents.get(token);
    if (!parent || parent.generation !== generation || parent.principalId !== principalId) return false;
    token = parent.previousToken;
  }
  return false;
}

function assertSessionConsent(value: SessionConsent): void {
  if (value?.consent !== true || !/^[a-z0-9][a-z0-9._-]{2,31}$/iu.test(value.privacyVersion) ||
      !/^[a-z0-9][a-z0-9._-]{2,31}$/iu.test(value.termsVersion) ||
      !/^[a-z0-9][a-z0-9._-]{2,31}$/iu.test(value.minorsVersion) ||
      !['adult', 'minor-14-17', 'under-14'].includes(value.ageBand)) {
    throw new SessionLoginError('USER_CONSENT_REQUIRED');
  }
}

function loginRetryError(): SessionLoginError {
  uni.showToast({ title: SESSION_LOGIN_RETRY_MESSAGE, icon: 'none' });
  return new SessionLoginError('SESSION_EXCHANGE_FAILED');
}

function loginUnavailableError(): SessionLoginError {
  uni.showToast({ title: SESSION_LOGIN_UNAVAILABLE_MESSAGE, icon: 'none' });
  return new SessionLoginError('SESSION_EXCHANGE_UNAVAILABLE');
}
function errorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function maintenanceError(): SessionLoginError {
  uni.showToast({ title: SESSION_MAINTENANCE_MESSAGE, icon: 'none' });
  return new SessionLoginError('WRITE_FROZEN');
}
