import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
const page = (name: string) => readFileSync(resolve(import.meta.dirname, '../src/pages', name, 'index.vue'), 'utf8');

// Execute the actual page script with isolated service adapters, not a copied page implementation.
function favoritesRuntime() {
  let token = '';
  let calls = 0;
  let prompts = 0;
  let fail = false;
  const exports: Record<string, any> = {};
  const adapters: Record<string, unknown> = {
    vue: { ref: (value: unknown) => ({ value }) },
    '@dcloudio/uni-app': { onShow() {} },
    '../../components/RequestStatePanel.vue': {}, '../../components/SingleAudioBar.vue': {},
    '../../services/assets': { DEFAULT_COVER_IMAGE: '' },
    '../../services/player': { formatDuration: String },
    '../../services/content-experience': { contentExperience: () => ({ label: '类型待标注' }), hasVisibleContentForm: () => true },
    '../../services/theme': { applyTheme() {} },
    '../../services/session': { getSessionToken: () => token },
    '../../services/session-scope': { promptLoginForAction: () => { prompts++; } },
    '../../services/network': { requestErrorMessage: () => '网络暂不可用' },
    '../../services/user-activity': {
      async getFavoriteSpaces() { calls++; if (fail) throw new Error('offline'); return []; },
      async getLastPlayedSpace() { calls++; return {}; }
    }
  };
  const script = parse(page('favorites')).descriptor.scriptSetup.content;
  const code = ts.transpileModule(script + '\nexport { loadFavorites, requestLogin, loginRequired, errorMessage, isLoading, spaces };',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require(id: string) { assert.ok(id in adapters, `unexpected import ${id}`); return adapters[id]; } });
  return { runtime: exports, setToken(value: string) { token = value; }, setFail() { fail = true; }, calls: () => calls, prompts: () => prompts };
}

test('anonymous favorites is a login state with no personal reads or automatic login', async () => {
  const h = favoritesRuntime();
  await h.runtime.loadFavorites();
  assert.equal(h.runtime.loginRequired.value, true);
  assert.equal(h.runtime.errorMessage.value, '');
  assert.equal(h.runtime.isLoading.value, false);
  assert.equal(h.calls(), 0);
  assert.equal(h.prompts(), 0);
  h.runtime.requestLogin();
  assert.equal(h.prompts(), 1);
});

test('authenticated empty favorites is distinct from anonymous and network failure', async () => {
  const h = favoritesRuntime(); h.setToken('fixture-token');
  await h.runtime.loadFavorites();
  assert.equal(h.runtime.loginRequired.value, false);
  assert.equal(h.runtime.spaces.value.length, 0);
  assert.equal(h.runtime.errorMessage.value, '');
  assert.equal(h.calls(), 2);
  h.setFail(); await h.runtime.loadFavorites();
  assert.equal(h.runtime.loginRequired.value, false);
  assert.equal(h.runtime.errorMessage.value, '网络暂不可用');
  assert.equal(h.prompts(), 0);
});

test('anonymous favorites has explicit login and browsing actions, never an error/retry panel', () => {
  const template = parse(page('favorites')).descriptor.template.content;
  assert.match(template, /v-if="loginRequired && !isLoading" class="empty login-panel"/u);
  assert.match(template, /@click="requestLogin">去登录/u);
  assert.match(template, /@click="browseContent">先去听听/u);
  assert.doesNotMatch(template, /kind="error"[^>]*LOGIN_REQUIRED_MESSAGE/u);
});

test('discover page leads with in-stock scene cards, then a playable today card', () => {
  const { template, styles } = parse(page('home')).descriptor;
  assert.ok(template.content.indexOf('class="scene-grid"') < template.content.indexOf('class="hero-card"'));
  assert.equal((template.content.match(/class="hero-card"/gu) || []).length, 1);
  assert.match(template.content, /v-for="scene in entranceScenes"/u);
  assert.match(template.content, /@click="openPrimaryScene\(scene\.id\)"/u);
  assert.match(template.content, /今日音乐空间/u);
  assert.match(template.content, /aria-label="播放"/u);
  assert.match(template.content, /继续播放/u);
  assert.match(template.content, /换一批/u);
  assert.match(styles[0].content, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.doesNotMatch(template.content, /类型待标注|学生专注空间|openStudentMode/u);
});

test('scene sort retains three options in one action menu without empty-page counter or automatic fallback', () => {
  const source = page('categories');
  assert.match(source, /label: '精选'.*value: 'featured'/u);
  assert.match(source, /label: '最新'.*value: 'latest'/u);
  assert.match(source, /label: '热门'.*value: 'hot'/u);
  assert.match(source, /@click="chooseSort"/u);
  assert.match(source, /uni.showActionSheet/u);
  assert.match(source, /if \(option\) selectSort\(option.value\)/u);
  assert.doesNotMatch(source, /汇总.*已确认分类|本页.*spaces.length/u);
  assert.match(source, /@click="browseRecommendations">返回推荐/u);
});

test('player controls have explicit names and settings preserve their existing handlers', () => {
  const source = page('player');
  assert.match(source, /@click="enterImmersion">隐藏控件/u);
  assert.match(source, /@click="revealPlayerControls">显示控件/u);
  assert.match(source, /@click="openPlayerPanel\('details'\)">内容介绍/u);
  assert.match(source, /timerLabel : '未开启'/u);
  assert.match(source, /@click="setVisualFit\('contain'\)">完整画面/u);
  assert.match(source, /@click="setVisualFit\('cover'\)">铺满屏幕/u);
  assert.doesNotMatch(source, /睡眠设置/u);
});
