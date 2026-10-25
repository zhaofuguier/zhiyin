import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = require('../tools/miniapp-build-core.cjs') as {
  disableUnapprovedPaymentRuntime(root: string): number;
  injectManifest(manifest: object, platform: string, appId: string): Record<string, { appid: string }>;
  scanProductionArtifact(root: string, options: Record<string, string>): { files: number };
  sha256File(file: string): string;
  validateAppId(platform: string, appId: string): string;
  validateMode(mode?: string): string;
  validateProductionApiOrigin(value?: string, options?: { allowTestOrigin?: boolean }): string;
};
const root = resolve(import.meta.dirname, '..');

function rejectsCode(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => error instanceof Error && error.message === code);
}

test('production mode and HTTPS origin are explicit and strict', () => {
  rejectsCode(() => core.validateMode(undefined), 'MINIAPP_BUILD_MODE_INVALID');
  rejectsCode(() => core.validateMode('mixed'), 'MINIAPP_BUILD_MODE_INVALID');
  assert.equal(core.validateMode('demo'), 'demo');
  assert.equal(core.validateMode('production'), 'production');
  for (const value of ['', 'http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.5', 'https://api.example.test', 'https://api.example.test/', 'https://api.example.test/path', 'https://u:p@api.example.test']) {
    rejectsCode(() => core.validateProductionApiOrigin(value), 'MINIAPP_PRODUCTION_API_ORIGIN_INVALID');
  }
  assert.equal(core.validateProductionApiOrigin('https://api.zhiyin.cn'), 'https://api.zhiyin.cn');
  assert.equal(core.validateProductionApiOrigin('https://api.example.test', { allowTestOrigin: true }), 'https://api.example.test');
});

test('single-platform AppID validation does not require the other platform', () => {
  assert.equal(core.validateAppId('mp-weixin', 'wx0000000000000000'), 'wx0000000000000000');
  assert.equal(core.validateAppId('mp-toutiao', 'tt0000000000000000'), 'tt0000000000000000');
  rejectsCode(() => core.validateAppId('mp-weixin', ''), 'MINIAPP_PLATFORM_APP_ID_INVALID');
  rejectsCode(() => core.validateAppId('mp-toutiao', ''), 'MINIAPP_PLATFORM_APP_ID_INVALID');
});

test('platform manifest injection is isolated and leaves source manifest byte-identical', () => {
  const manifestFile = join(root, 'src', 'manifest.json');
  const before = core.sha256File(manifestFile);
  const source = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const wechat = core.injectManifest(source, 'mp-weixin', 'wx0000000000000000');
  const douyin = core.injectManifest(source, 'mp-toutiao', 'tt0000000000000000');
  assert.equal(wechat['mp-weixin'].appid, 'wx0000000000000000');
  assert.equal(wechat['mp-toutiao'].appid, '');
  assert.equal(douyin['mp-toutiao'].appid, 'tt0000000000000000');
  assert.equal(douyin['mp-weixin'].appid, '');
  assert.equal(core.sha256File(manifestFile), before);
});

test('production scanner accepts clean artifact and rejects planted demo or secret markers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'zhiyin-mini-scan-'));
  try {
    const options = { platform: 'mp-weixin', apiBaseUrl: 'https://api.example.test', appId: 'wx0000000000000000', otherPlatformAppId: 'tt0000000000000000' };
    writeFileSync(join(temp, 'build-meta.json'), JSON.stringify({ mode: 'production', platform: options.platform, apiBaseUrl: options.apiBaseUrl, appId: options.appId }));
    writeFileSync(join(temp, 'app.js'), 'const state="ready";');
    assert.equal(core.scanProductionArtifact(temp, options).files, 2);
    writeFileSync(join(temp, 'bad.js'), 'const order="demo-order-123";');
    rejectsCode(() => core.scanProductionArtifact(temp, options), 'MINIAPP_PRODUCTION_ARTIFACT_REJECTED');
    writeFileSync(join(temp, 'bad.js'), 'const secret="DATABASE_URL";');
    rejectsCode(() => core.scanProductionArtifact(temp, options), 'MINIAPP_PRODUCTION_ARTIFACT_REJECTED');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('membership payment is closed and production rejects mock payment artifacts', () => {
  const page = readFileSync(join(root, 'src', 'pages', 'member', 'index.vue'), 'utf8');
  const user = readFileSync(join(root, 'src', 'services', 'user.ts'), 'utf8');
  assert.match(page, /暂未开放/);
  assert.match(page, /disabled/);
  assert.doesNotMatch(page, /createMembershipOrder|confirmMockPayment|requestPayment|tt\.pay/);
  assert.doesNotMatch(user, /\/mock-pay|confirmMockPayment/);

  const temp = mkdtempSync(join(tmpdir(), 'zhiyin-mini-payment-scan-'));
  try {
    const options = {
      platform: 'mp-weixin',
      apiBaseUrl: 'https://api.example.test',
      appId: 'wx0000000000000000',
      otherPlatformAppId: 'tt0000000000000000'
    };
    writeFileSync(join(temp, 'build-meta.json'), JSON.stringify({
      mode: 'production',
      platform: options.platform,
      apiBaseUrl: options.apiBaseUrl,
      appId: options.appId
    }));
    writeFileSync(join(temp, 'app.js'), 'fetch("/api/orders/order-1/mock-pay")');
    rejectsCode(() => core.scanProductionArtifact(temp, options), 'MINIAPP_PRODUCTION_ARTIFACT_REJECTED');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test('production build strips framework payment launch aliases and rejects application-owned launchers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'zhiyin-mini-runtime-strip-'));
  try {
    mkdirSync(join(temp, 'common'), { recursive: true });
    writeFileSync(join(temp, 'common', 'vendor.js'), 'const x=tt.pay?requestPayment:null;');
    assert.equal(core.disableUnapprovedPaymentRuntime(temp), 2);
    const vendor = readFileSync(join(temp, 'common', 'vendor.js'), 'utf8');
    assert.doesNotMatch(vendor, /requestPayment|tt\.pay/);

    writeFileSync(join(temp, 'app.js'), 'uni.requestPayment({});');
    rejectsCode(() => core.disableUnapprovedPaymentRuntime(temp), 'MINIAPP_UNAPPROVED_PAYMENT_RUNTIME');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
test('demo data and production stubs remain separate', () => {
  const demo = readFileSync(join(root, 'src', 'demo', 'music-spaces.ts'), 'utf8');
  const production = readFileSync(join(root, 'src', 'demo', 'music-spaces.production.ts'), 'utf8');
  assert.match(demo, /forest-cabin-rain/);
  assert.doesNotMatch(production, /forest-cabin-rain|homework-focus|12860|local-order/);
  assert.match(readFileSync(join(root, 'src', 'components', 'DemoModeBadge.vue'), 'utf8'), /演示模式/);
});

test('production request failures propagate while demo fallback is explicitly gated', () => {
  const api = readFileSync(join(root, 'src', 'services', 'api.ts'), 'utf8');
  const network = readFileSync(join(root, 'src', 'services', 'network.ts'), 'utf8');
  const user = readFileSync(join(root, 'src', 'services', 'user.ts'), 'utf8');
  assert.match(api, /if \(!IS_DEMO_MODE\) throw error/);
  assert.match(network, /if \(IS_DEMO_MODE\) return undefined;\s*throw error/);
  assert.match(user, /ensureDemoMode\(\)/);
  assert.doesNotMatch(user, /local-order-|local-demo-/);
});

test('empty and failed states are distinct and errors expose retry', () => {
  const panel = readFileSync(join(root, 'src', 'components', 'RequestStatePanel.vue'), 'utf8');
  assert.match(panel, /kind === 'empty'/);
  assert.match(panel, /kind === 'error'/);
  assert.match(panel, /@click="\$emit\('retry'\)"/);
  for (const page of ['home', 'categories', 'favorites', 'search']) {
    const source = readFileSync(join(root, 'src', 'pages', page, 'index.vue'), 'utf8');
    assert.match(source, /RequestStatePanel/);
    assert.match(source, /requestErrorMessage/);
  }
});

test('authentication retries only one 401 and never retries 502 or 503', () => {
  const network = readFileSync(join(root, 'src', 'services', 'network.ts'), 'utf8');
  const session = readFileSync(join(root, 'src', 'services', 'session.ts'), 'utf8');
  const renewalBlock = /export async function renewSession[\s\S]*?export async function recoverSessionAfterUnauthorized/u.exec(session)?.[0] || '';
  assert.equal((network.match(/await recoverSessionAfterUnauthorized/g) || []).length, 1);
  assert.match(network, /statusCode !== 401/);
  assert.doesNotMatch(renewalBlock, /setInterval|while\s*\(|establishSession/);
  assert.match(session, /WRITE_FROZEN/);
});


test('staged build failure leaves the source manifest unchanged', () => {
  const manifestFile = join(root, 'src', 'manifest.json');
  const before = core.sha256File(manifestFile);
  const result = spawnSync(process.execPath, [join(root, 'tools', 'miniapp-build.cjs'), '--mode=production', '--platform=mp-weixin'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MINIAPP_TEST_FAIL_AFTER_STAGING: '1',
      VITE_API_BASE_URL: 'https://api.example.test',
      WECHAT_MINIAPP_APP_ID: 'wx0000000000000000'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MINIAPP_TEST_STAGED_FAILURE/);
  assert.equal(core.sha256File(manifestFile), before);
});
test('production source manifest contains no committed platform AppID', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8'));
  assert.equal(manifest['mp-weixin'].appid, '');
  assert.equal(manifest['mp-toutiao'].appid, '');
});

test('release candidate builder references production-only miniapp commands', () => {
  const releaseTool = readFileSync(resolve(root, '..', '..', 'tools', 'build-local-release-candidate.cjs'), 'utf8');
  assert.match(releaseTool, /build:mp-weixin:prod/);
  assert.match(releaseTool, /build:mp-toutiao:prod/);
  assert.doesNotMatch(releaseTool, /\['run', 'build:mp-weixin'\]/);
  assert.doesNotMatch(releaseTool, /\['run', 'build:mp-toutiao'\]/);
});
