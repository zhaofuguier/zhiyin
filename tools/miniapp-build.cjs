const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { verifyFeedbackCatalog } = require('../../../tools/feedback-catalog-core.cjs');
const { assertProductionSizeBudget } = require('./miniapp-size-budget.cjs');
const {
  disableUnapprovedPaymentRuntime,
  expectedProjectAppId,
  injectManifest,
  includeSourceAsset,
  scanProductionArtifact,
  sha256File,
  validateAppId,
  validateMode,
  validatePlatform,
  validateProductionApiOrigin
} = require('./miniapp-build-core.cjs');

function argument(name) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : undefined;
}
function main() {
  const projectDir = path.resolve(__dirname, '..');
  verifyFeedbackCatalog(path.resolve(projectDir, '..', '..'));
  const mode = validateMode(argument('mode'));
  const platform = validatePlatform(argument('platform'));
  const command = argument('command') || 'build';
  if (!['build', 'dev'].includes(command)) throw new Error('MINIAPP_BUILD_COMMAND_INVALID');
  const apiBaseUrl = (process.env.VITE_API_BASE_URL || '').trim();
  if (mode === 'production') validateProductionApiOrigin(apiBaseUrl, { allowTestOrigin: process.env.NODE_ENV === 'test' });
  const appIdVariable = platform === 'mp-weixin' ? 'WECHAT_MINIAPP_APP_ID' : 'DOUYIN_MINIAPP_APP_ID';
  const fallbackDemoAppId = platform === 'mp-weixin' ? 'wxdemomode00000000' : 'ttdemomode00000000';
  const appId = platform === 'h5' ? '' : validateAppId(platform, (process.env[appIdVariable] || (mode === 'demo' ? fallbackDemoAppId : '')).trim());
  const douyinShareTemplateId = validateOptionalShareTemplate(
    platform === 'mp-toutiao' ? process.env.DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID : ''
  );
  const sourceManifest = path.join(projectDir, 'src', 'manifest.json');
  const sourceManifestHash = sha256File(sourceManifest);
  const useSourceInput = command === 'dev' && platform === 'h5';
  const tempRoot = useSourceInput ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyin-miniapp-' + mode + '-' + platform + '-'));
  const tempInput = useSourceInput ? path.join(projectDir, 'src') : path.join(tempRoot, 'src');
  const outputDir = path.join(projectDir, 'dist', mode, platform);
  let outputTouched = false;
  try {
    if (!useSourceInput) {
      copyTree(path.join(projectDir, 'src'), tempInput, mode);
      if (mode === 'production') {
        replaceDemoModules(tempInput);
        writeProductionConfig(tempInput, apiBaseUrl, douyinShareTemplateId);
        fs.copyFileSync(path.join(tempInput, 'components', 'DemoModeBadge.production.vue'), path.join(tempInput, 'components', 'DemoModeBadge.vue'));
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(tempInput, 'manifest.json'), 'utf8'));
      fs.writeFileSync(path.join(tempInput, 'manifest.json'), `${JSON.stringify(injectManifest(manifest, platform, appId), null, 2)}\n`, 'utf8');
    }
    if (process.env.NODE_ENV === 'test' && process.env.MINIAPP_TEST_FAIL_AFTER_STAGING === '1') throw new Error('MINIAPP_TEST_STAGED_FAILURE');
    fs.rmSync(outputDir, { recursive: true, force: true });
    outputTouched = true;
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    const uniCli = require.resolve('@dcloudio/vite-plugin-uni/bin/uni.js');
    const uniArgs = [uniCli, command, '-p', platform];
    if (command === 'dev' && platform === 'h5') {
      uniArgs.push('--host', '127.0.0.1', '--port', '5173');
    }
    const result = spawnSync(process.execPath, uniArgs, {
      cwd: projectDir,
      env: {
        ...process.env,
        VITE_APP_MODE: mode,
        VITE_API_BASE_URL: apiBaseUrl,
        UNI_INPUT_DIR: tempInput,
        UNI_OUTPUT_DIR: outputDir
      },
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`MINIAPP_BUILD_FAILED_${result.status}`);
    if (command === 'dev') return;
    const generatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(outputDir, 'build-meta.json'), `${JSON.stringify({
      mode, platform, apiBaseUrl, appId,
      coListenNativeShareConfigured: platform === 'mp-weixin' || Boolean(douyinShareTemplateId),
      generatedAt
    }, null, 2)}\n`, 'utf8');
    if (platform !== 'h5' && expectedProjectAppId(outputDir, platform) !== appId) throw new Error('MINIAPP_OUTPUT_APP_ID_MISMATCH');
    if (mode === 'production') disableUnapprovedPaymentRuntime(outputDir);
    if (mode === 'production') scanProductionArtifact(outputDir, { mode, platform, apiBaseUrl, appId, otherPlatformAppId: platform === 'mp-weixin' ? process.env.DOUYIN_MINIAPP_APP_ID : process.env.WECHAT_MINIAPP_APP_ID });
    const sizeBudget = mode === 'production' && platform !== 'h5'
      ? assertProductionSizeBudget(outputDir, platform) : undefined;
    if (sha256File(sourceManifest) !== sourceManifestHash) throw new Error('MINIAPP_SOURCE_MANIFEST_CHANGED');
    process.stdout.write(`${JSON.stringify({ ok: true, mode, platform, sizeBudget, outputDir: path.relative(projectDir, outputDir).replaceAll('\\', '/') })}\n`);
  } catch (error) {
    if (command === 'build' && outputTouched) fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    if (tempRoot) removeTree(tempRoot);
    if (sha256File(sourceManifest) !== sourceManifestHash) throw new Error('MINIAPP_SOURCE_MANIFEST_CHANGED');
  }
}
function removeTree(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) removeTree(target);
    else fs.unlinkSync(target);
  }
  fs.rmdirSync(root);
}
function copyTree(source, target, mode, sourceRoot = source) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (!includeSourceAsset(mode, path.relative(sourceRoot, from))) continue;
    if (entry.isDirectory()) copyTree(from, to, mode, sourceRoot);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}
function writeProductionConfig(tempInput, apiBaseUrl, douyinShareTemplateId) {
  const source = [
    "export type AppMode = 'demo' | 'production';",
    "export const APP_MODE: AppMode = 'production';",
    'export const IS_DEMO_MODE = false;',
    'export const IS_PRODUCTION_MODE = true;',
    `export const API_BASE_URL = ${JSON.stringify(apiBaseUrl)};`,
    `export const DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID = ${JSON.stringify(douyinShareTemplateId)};`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(tempInput, 'services', 'config.ts'), source, 'utf8');
}
function validateOptionalShareTemplate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(normalized)) throw new Error('DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID_INVALID');
  return normalized;
}
function replaceDemoModules(tempInput) {
  const replacements = ['music-spaces', 'business-data', 'scene-configs', 'scene-covers'];
  for (const name of replacements) {
    fs.copyFileSync(path.join(tempInput, 'demo', `${name}.production.ts`), path.join(tempInput, 'demo', `${name}.ts`));
  }
}
try { main(); } catch (error) {
  process.stderr.write(`${error && error.code ? error.code : error.message}\n`);
  if (process.env.MINIAPP_BUILD_DEBUG === '1' && error && error.stack) process.stderr.write(`${error.stack}\n`);
  if (error && Array.isArray(error.findings)) process.stderr.write(`${JSON.stringify(error.findings)}\n`);
  process.exitCode = 1;
}
