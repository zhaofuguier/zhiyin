import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { SIZE_BUDGET, assertProductionSizeBudget } = require('../tools/miniapp-size-budget.cjs');
const { includeSourceAsset, scanProductionArtifact } = require('../tools/miniapp-build-core.cjs');

function withArtifact(action: (root: string, write: (name: string, value: string | Buffer) => void) => void) {
  const root = mkdtempSync(join(tmpdir(), 'zhiyin-size-budget-'));
  const write = (name: string, value: string | Buffer) => {
    const pieces = name.split('/'); pieces.pop();
    mkdirSync(join(root, ...pieces), { recursive: true });
    writeFileSync(join(root, name), value);
  };
  write('app.json', JSON.stringify({ pages: ['pages/home/index'] }));
  try { action(root, write); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('source resource boundary excludes all four demo images only for production', () => {
  for (const name of ['forest-cabin', 'ocean-sunset', 'deep-station', 'night-cafe']) {
    const file = `static/images/zhiyin-${name}.png`;
    assert.equal(includeSourceAsset('production', file), false);
    assert.equal(includeSourceAsset('demo', file), true);
  }
  assert.equal(includeSourceAsset('production', 'static/tabbar/player-active.png'), true);
  const build = readFileSync(new URL('../tools/miniapp-build.cjs', import.meta.url), 'utf8');
  assert.match(build, /includeSourceAsset\(mode, path.relative\(sourceRoot, from\)\)/);
  assert.match(build, /assertProductionSizeBudget\(outputDir, platform\)/);
});

test('production scan rejects reintroduced demo binary images even without text references', () => withArtifact((root, write) => {
  const options = { platform: 'mp-weixin', apiBaseUrl: 'https://api.example.test', appId: 'wx0000000000000000' };
  write('build-meta.json', JSON.stringify({ ...options, mode: 'production' }));
  write('static/images/zhiyin-night-cafe.png', Buffer.from([1, 2, 3]));
  assert.throws(() => scanProductionArtifact(root, options), /MINIAPP_PRODUCTION_ARTIFACT_REJECTED/);
}));

test('both platforms apply the internal budget to all files, not only JavaScript', () => withArtifact((root, write) => {
  write('static/icon.png', Buffer.alloc(100));
  for (const platform of ['mp-weixin', 'mp-toutiao']) {
    const report = assertProductionSizeBudget(root, platform);
    assert.equal(report.mainBytes, report.totalBytes);
    assert.ok(report.totalBytes > 100);
    assert.deepEqual(report.failures, []);
  }
  write('large.bin', Buffer.alloc(SIZE_BUDGET.main));
  assert.throws(() => assertProductionSizeBudget(root, 'mp-weixin'), /MINIAPP_SIZE_BUDGET_EXCEEDED/);
}));

test('one oversized static resource fails even while the main package is under budget', () => withArtifact((root, write) => {
  write('static/large.png', Buffer.alloc(SIZE_BUDGET.staticFile + 1));
  assert.throws(() => assertProductionSizeBudget(root, 'mp-weixin'), /MINIAPP_SIZE_BUDGET_EXCEEDED/);
}));

test('subpackage accounting respects directory boundaries and rejects oversized subpackages', () => withArtifact((root, write) => {
  write('app.json', JSON.stringify({ subPackages: [{ root: 'feature' }] }));
  write('feature/page.js', Buffer.alloc(100));
  write('feature-other/page.js', Buffer.alloc(200));
  const report = assertProductionSizeBudget(root, 'mp-toutiao');
  assert.equal(report.subpackageBytes.feature, 100);
  assert.ok(report.mainBytes >= 200);
  write('feature/page.js', Buffer.alloc(SIZE_BUDGET.subpackage + 1));
  assert.throws(() => assertProductionSizeBudget(root, 'mp-toutiao'), /MINIAPP_SIZE_BUDGET_EXCEEDED/);
}));

test('total size and ambiguous subpackage roots fail closed', () => withArtifact((root, write) => {
  const roots = Array.from({ length: 6 }, (_, i) => `feature${i}`);
  write('app.json', JSON.stringify({ subPackages: roots.map(root => ({ root })) }));
  for (const name of roots) write(`${name}/page.js`, Buffer.alloc(SIZE_BUDGET.subpackage));
  assert.throws(() => assertProductionSizeBudget(root, 'mp-weixin'), /MINIAPP_SIZE_BUDGET_EXCEEDED/);
  for (const values of [['../outside'], ['feature', 'feature/child'], ['feature', 'feature']]) {
    write('app.json', JSON.stringify({ subPackages: values.map(root => ({ root })) }));
    assert.throws(() => assertProductionSizeBudget(root, 'mp-weixin'), /MINIAPP_SUBPACKAGE_ROOT_INVALID/);
  }
}));
