const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLATFORMS = new Set(['mp-weixin', 'mp-toutiao', 'h5']);
const MODES = new Set(['demo', 'production']);
const DEMO_IMAGE_PATHS = new Set([
  'static/images/zhiyin-forest-cabin.png', 'static/images/zhiyin-ocean-sunset.png',
  'static/images/zhiyin-deep-station.png', 'static/images/zhiyin-night-cafe.png'
]);

function includeSourceAsset(mode, relativePath) {
  return mode !== 'production' || !DEMO_IMAGE_PATHS.has(relativePath.replaceAll('\\', '/'));
}
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.wxml', '.wxss', '.ttml', '.ttss', '.txt']);

function validateMode(mode) {
  if (!MODES.has(mode)) throw gateError('MINIAPP_BUILD_MODE_INVALID');
  return mode;
}
function validatePlatform(platform) {
  if (!PLATFORMS.has(platform)) throw gateError('MINIAPP_BUILD_PLATFORM_INVALID');
  return platform;
}
function validateProductionApiOrigin(value, options = {}) {
  let parsed;
  try { parsed = new URL(value); } catch { throw gateError('MINIAPP_PRODUCTION_API_ORIGIN_INVALID'); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.origin !== value || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash || value.endsWith('/') || isForbiddenHost(host, options.allowTestOrigin === true)) {
    throw gateError('MINIAPP_PRODUCTION_API_ORIGIN_INVALID');
  }
  return value;
}
function isForbiddenHost(host, allowTestOrigin) {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1') return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return true;
  const match172 = /^172\.(\d{1,3})\./.exec(host);
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
  if (/^(?:fc|fd|fe80:)/.test(host)) return true;
  if (!allowTestOrigin && (host.endsWith('.test') || host.endsWith('.example') || host.endsWith('.invalid') || host === 'example.com' || host.endsWith('.example.com'))) return true;
  return !host.includes('.');
}
function validateAppId(platform, appId) {
  if (platform === 'h5') return '';
  const pattern = platform === 'mp-weixin' ? /^wx[a-zA-Z0-9_-]{10,62}$/ : /^tt[a-zA-Z0-9_-]{10,62}$/;
  if (!pattern.test(appId || '')) throw gateError('MINIAPP_PLATFORM_APP_ID_INVALID');
  return appId;
}
function injectManifest(manifest, platform, appId) {
  const result = JSON.parse(JSON.stringify(manifest));
  result['mp-weixin'] = { ...(result['mp-weixin'] || {}), appid: platform === 'mp-weixin' ? appId : '' };
  result['mp-toutiao'] = { ...(result['mp-toutiao'] || {}), appid: platform === 'mp-toutiao' ? appId : '' };
  return result;
}
function expectedProjectAppId(outputDir, platform) {
  if (platform === 'h5') return undefined;
  const projectConfig = path.join(outputDir, 'project.config.json');
  if (!fs.existsSync(projectConfig)) throw gateError('MINIAPP_PROJECT_CONFIG_MISSING');
  const data = JSON.parse(fs.readFileSync(projectConfig, 'utf8'));
  return data.appid;
}
function scanProductionArtifact(root, options) {
  const findings = [];
  const files = listFiles(root);
  const forbidden = [
    ['legacy-http-ip', 'http://118.196.48.205:3000'],
    ['insecure-business-url', 'http://'],
    ['localhost', 'localhost'],
    ['loopback', '127.0.0.1'],
    ['database-url', 'DATABASE_URL'],
    ['session-key', 'session_key'],
    ['payment-launcher', 'requestPayment'],
    ['payment-launcher', 'tt.pay'],
    ['mock-payment-route', '/mock-pay'],
    ['wechat-secret', 'WECHAT_MINIAPP_APP_SECRET'],
    ['douyin-secret', 'DOUYIN_MINIAPP_APP_SECRET'],
    ['demo-space', 'forest-cabin-rain'],
    ['demo-space', 'homework-focus'],
    ['demo-order', 'demo-order-'],
    ['demo-user', 'demo-user-'],
    ['demo-label', '演示模式'],
    ['demo-label', '开发预览'],
    ['demo-label', '演示支付'],
    ['fake-school-stat', 'studentCount:128'],
    ['client-identity-derivation', '${provider}-${loginCode}'],
    ['cross-platform-invite', '复制邀请码'],
    ['cross-platform-invite', '输入邀请码']
  ];
  if (options.otherPlatformAppId) forbidden.push(['other-platform-appid', options.otherPlatformAppId]);
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (DEMO_IMAGE_PATHS.has(relative)) findings.push({ kind: 'demo-image', file: relative });
    if (file.endsWith('.map')) findings.push({ kind: 'source-map', file: relative });
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const [kind, marker] of forbidden) {
      if (content.includes(marker)) findings.push({ kind, file: relative });
    }
    for (const marker of DEMO_IMAGE_PATHS) {
      if (content.includes(marker)) findings.push({ kind: 'demo-image-reference', file: relative });
    }
  }
  const metaFile = path.join(root, 'build-meta.json');
  if (!fs.existsSync(metaFile)) findings.push({ kind: 'build-meta-missing', file: 'build-meta.json' });
  else {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (meta.mode !== 'production') findings.push({ kind: 'mode-not-production', file: 'build-meta.json' });
    if (meta.apiBaseUrl !== options.apiBaseUrl) findings.push({ kind: 'api-origin-mismatch', file: 'build-meta.json' });
    if (meta.platform !== options.platform) findings.push({ kind: 'platform-mismatch', file: 'build-meta.json' });
    if (meta.appId !== options.appId) findings.push({ kind: 'appid-mismatch', file: 'build-meta.json' });
  }
  if (findings.length) {
    const error = gateError('MINIAPP_PRODUCTION_ARTIFACT_REJECTED');
    error.findings = findings;
    throw error;
  }
  return { files: files.length, findings: [] };
}
function disableUnapprovedPaymentRuntime(root) {
  let replacements = 0;
  for (const file of listFiles(root).filter((value) => path.extname(value).toLowerCase() === '.js')) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const content = fs.readFileSync(file, 'utf8');
    const hasPaymentRuntime = content.includes('requestPayment') || content.includes('tt.pay');
    if (!hasPaymentRuntime) continue;
    if (relative !== 'common/vendor.js') throw gateError('MINIAPP_UNAPPROVED_PAYMENT_RUNTIME');
    const next = content
      .replaceAll('requestPayment', 'paymentFeatureDisabled')
      .replaceAll('tt.pay', 'tt.disabledApi');
    replacements += countOccurrences(content, 'requestPayment') + countOccurrences(content, 'tt.pay');
    fs.writeFileSync(file, next, 'utf8');
  }
  return replacements;
}
function countOccurrences(value, marker) {
  return value.split(marker).length - 1;
}
function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else if (entry.isFile()) results.push(full);
  }
  return results.sort();
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function gateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
module.exports = {
  includeSourceAsset,
  disableUnapprovedPaymentRuntime,
  injectManifest,
  listFiles,
  scanProductionArtifact,
  sha256File,
  validateAppId,
  validateMode,
  validatePlatform,
  validateProductionApiOrigin,
  expectedProjectAppId
};
