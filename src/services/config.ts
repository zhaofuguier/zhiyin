export type AppMode = 'demo' | 'production';

const rawMode = import.meta.env.VITE_APP_MODE;
if (rawMode !== 'demo' && rawMode !== 'production') {
  throw new Error('MINIAPP_BUILD_MODE_INVALID');
}

export const APP_MODE: AppMode = rawMode;
export const IS_DEMO_MODE = APP_MODE === 'demo';
export const IS_PRODUCTION_MODE = APP_MODE === 'production';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
if (IS_PRODUCTION_MODE && !isProductionApiOrigin(rawApiBaseUrl)) {
  throw new Error('MINIAPP_PRODUCTION_API_ORIGIN_INVALID');
}

export const API_BASE_URL = rawApiBaseUrl.endsWith('/')
  ? rawApiBaseUrl.slice(0, -1)
  : rawApiBaseUrl;

export const DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID =
  (import.meta.env.DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID || '').trim();

function isProductionApiOrigin(value: string): boolean {
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/iu.test(value)) return false;
  const host = value.slice('https://'.length).split(':')[0].toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) return false;
  if (host.endsWith('.test') || host.endsWith('.example') || host.endsWith('.invalid') || host === 'example.com' || host.endsWith('.example.com')) return false;
  return host.includes('.');
}
