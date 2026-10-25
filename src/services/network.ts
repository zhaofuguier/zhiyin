import { API_BASE_URL, IS_DEMO_MODE } from './config';
import {
  currentRuntimePlatform,
  getSessionToken,
  recoverSessionAfterUnauthorized,
  SESSION_LOGIN_RETRY_MESSAGE,
  SESSION_LOGIN_UNAVAILABLE_MESSAGE,
  SESSION_MAINTENANCE_MESSAGE,
  SessionLoginError
} from './session';
import { ApiResponseContractError } from './response-contract';
import { captureSessionScope, isSessionScopeCurrent } from './session-scope';

const NETWORK_STATE_KEY = 'zhiyin.networkState';
const REQUEST_TIMEOUT_MS = 8000;

export type NetworkStatus = 'online' | 'demo' | 'loading' | 'retrying' | 'recovered' | 'error' | 'auth-error' | 'unavailable' | 'maintenance' | 'stale';

export interface NetworkState {
  status: NetworkStatus;
  message: string;
  checkedAt: string;
}
export interface RequestJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: string | ArrayBuffer | Record<string, unknown>;
  header?: Record<string, string>;
  retryAuthentication?: boolean;
}
export class ApiRequestError extends Error {
  constructor(readonly statusCode: number | undefined, readonly code: string) {
    super(code);
    this.name = 'ApiRequestError';
  }
}

export function getNetworkState(): NetworkState {
  return uni.getStorageSync(NETWORK_STATE_KEY) || state(
    IS_DEMO_MODE ? 'demo' : 'online',
    IS_DEMO_MODE ? '演示模式' : '服务连接正常'
  );
}
export function markLoading(): void { saveNetworkState({ status: 'loading', message: '正在加载' }); }
export function markRetrying(): void { saveNetworkState({ status: 'retrying', message: '正在重试' }); }
export function markStale(): void { saveNetworkState({ status: 'stale', message: '内容可能不是最新' }); }
export function markDemo(): void { saveNetworkState({ status: 'demo', message: '演示模式' }); }
export function markFallback(message = '服务暂不可用，请稍后重试'): void {
  saveNetworkState({ status: message === SESSION_MAINTENANCE_MESSAGE ? 'maintenance' : 'unavailable', message });
}
export function markOnline(): void {
  const previous = getNetworkState().status;
  const recovered = ['retrying', 'error', 'unavailable', 'stale'].includes(previous);
  saveNetworkState(recovered
    ? { status: 'recovered', message: '重试成功，内容已更新' }
    : { status: 'online', message: '服务连接正常' });
}

export async function requestJson<T>(path: string, options?: RequestJsonOptions): Promise<T | undefined> {
  if (!API_BASE_URL) {
    if (IS_DEMO_MODE) {
      markDemo();
      return undefined;
    }
    throw new ApiRequestError(undefined, 'API_CONFIGURATION_MISSING');
  }
  try {
    return await executeRequest<T>(path, options);
  } catch (error) {
    recordRequestFailure(error);
    if (IS_DEMO_MODE) return undefined;
    throw error;
  }
}

export async function requestAuthenticatedJson<T>(path: string, options?: RequestJsonOptions): Promise<T> {
  if (!API_BASE_URL) throw new ApiRequestError(undefined, 'SESSION_API_UNAVAILABLE');
  const requestToken = getSessionToken();
  if (!requestToken) {
    const error = new SessionLoginError('USER_CONSENT_REQUIRED');
    recordSessionFailure(error);
    throw error;
  }
  const requestScope = captureSessionScope();
  try {
    return await executeRequest<T>(path, withAuthorization(options, requestToken));
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.statusCode !== 401 || options?.retryAuthentication === false) {
      recordRequestFailure(error);
      throw error;
    }
    if (!isSessionScopeCurrent(requestScope)) {
      throw new ApiRequestError(401, 'USER_SESSION_CHANGED');
    }
    let renewedToken: string;
    try {
      renewedToken = await recoverSessionAfterUnauthorized(requestToken);
    } catch (sessionError) {
      recordSessionFailure(sessionError);
      throw sessionError;
    }
    if (!isSessionScopeCurrent(requestScope)) throw new ApiRequestError(401, 'USER_SESSION_CHANGED');
    return executeRequest<T>(path, withAuthorization(options, renewedToken));
  }
}

export function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiResponseContractError) return '服务数据异常，请稍后重试';
  if (error instanceof SessionLoginError) {
    if (error.code === 'UNDER_14_ACCOUNT_NOT_AVAILABLE') return '暂不提供未满14周岁用户账号服务';
    if (error.code === 'USER_CONSENT_REQUIRED') return '请先阅读并同意隐私政策与用户协议';
    if (error.code === 'WRITE_FROZEN') return SESSION_MAINTENANCE_MESSAGE;
    if (error.code === 'SESSION_EXCHANGE_UNAVAILABLE') return SESSION_LOGIN_UNAVAILABLE_MESSAGE;
    return SESSION_LOGIN_RETRY_MESSAGE;
  }
  if (error instanceof ApiRequestError) {
    if (error.code === 'WRITE_FROZEN') return SESSION_MAINTENANCE_MESSAGE;
    if (error.statusCode === 401) return SESSION_LOGIN_RETRY_MESSAGE;
    if (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === undefined) return '服务暂不可用，请稍后重试';
  }
  return '加载失败，请稍后重试';
}

function recordSessionFailure(error: unknown): void {
  if (error instanceof SessionLoginError && error.code === 'WRITE_FROZEN') {
    markFallback(SESSION_MAINTENANCE_MESSAGE);
  } else if (error instanceof SessionLoginError && error.code === 'SESSION_EXCHANGE_UNAVAILABLE') {
    saveNetworkState({ status: 'unavailable', message: SESSION_LOGIN_UNAVAILABLE_MESSAGE });
  } else {
    saveNetworkState({ status: 'auth-error', message: SESSION_LOGIN_RETRY_MESSAGE });
  }
}
function recordRequestFailure(error: unknown): void {
  if (error instanceof ApiResponseContractError) {
    saveNetworkState({ status: 'error', message: '服务数据异常，请稍后重试' });
  } else if (error instanceof ApiRequestError && error.code === 'WRITE_FROZEN') {
    markFallback(SESSION_MAINTENANCE_MESSAGE);
  } else if (error instanceof ApiRequestError && error.statusCode === 401) {
    saveNetworkState({ status: 'auth-error', message: SESSION_LOGIN_RETRY_MESSAGE });
  } else if (error instanceof ApiRequestError && (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === undefined)) {
    saveNetworkState({ status: 'unavailable', message: '服务暂不可用，请稍后重试' });
  } else {
    saveNetworkState({ status: 'error', message: '加载失败，请稍后重试' });
  }
}
function withAuthorization(options?: RequestJsonOptions, suppliedToken?: string): RequestJsonOptions {
  const token = suppliedToken || getSessionToken();
  if (!token) throw new ApiRequestError(401, 'USER_SESSION_REQUIRED');
  return { ...options, header: { ...options?.header, Authorization: `Bearer ${token}` } };
}
function executeRequest<T>(path: string, options?: RequestJsonOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const platform = currentRuntimePlatform();
    uni.request({
      url: `${API_BASE_URL}${path}`,
      method: options?.method as UniApp.RequestOptions['method'],
      data: options?.data,
      header: {
        ...(platform ? { 'X-Zhiyin-Platform': platform } : {}),
        ...options?.header
      },
      timeout: REQUEST_TIMEOUT_MS,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          markOnline();
          resolve(res.data as T);
          return;
        }
        reject(new ApiRequestError(res.statusCode, responseCode(res.data)));
      },
      fail: () => reject(new ApiRequestError(undefined, 'NETWORK_REQUEST_FAILED'))
    });
  });
}
function responseCode(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    for (const key of ['code', 'message'] as const) {
      if (key in value && typeof (value as Record<string, unknown>)[key] === 'string') {
        return (value as Record<string, string>)[key];
      }
    }
  }
  return 'API_REQUEST_FAILED';
}
function state(status: NetworkStatus, message: string): NetworkState {
  return { status, message, checkedAt: new Date().toISOString() };
}
function saveNetworkState(input: Omit<NetworkState, 'checkedAt'>): void {
  const next = state(input.status, input.message);
  uni.setStorageSync(NETWORK_STATE_KEY, next);
  uni.$emit('zhiyin:network-state', next);
}
