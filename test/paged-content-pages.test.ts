import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { after, beforeEach } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(root, '.test-paged-pages-'));
const outputs = new Map<string, string>();
const exportsByPage = {
  home: `export { loadHomeData, selectPrimaryScene, selectSecondaryScene, clearScene }; export function state() { return { items: featuredSpaces.value, latest: latestSpaces.value, hero: hero.value, loading: isLoading.value, error: errorMessage.value }; }`,
  categories: `export { selectPrimary, selectSecondary, selectSort, goToPage, retryPageRequest }; export function state() { return { items: spaces.value, page: currentPage.value, more: hasMore.value, loading: isLoading.value, paging: isPaging.value, error: errorMessage.value, pageError: pageError.value }; }`,
  search: `export { runSearch, goToPage, retryPageRequest }; export function state() { return { items: spaces.value, page: currentPage.value, more: hasMore.value, loading: isLoading.value, paging: isPaging.value, error: errorMessage.value, pageError: pageError.value }; }`
};
try { for (const [page, exports] of Object.entries(exportsByPage)) {
  const directory = join(root, 'src/pages', page);
  const source = readFileSync(join(directory, 'index.vue'), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/u)![1];
  const output = join(temp, `${page}.cjs`);
  await build({
    stdin: { contents: `${source}\n${exports}`, resolveDir: directory, loader: 'ts' },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent',
    define: { 'import.meta.env': JSON.stringify({ VITE_APP_MODE: 'production', VITE_API_BASE_URL: 'https://api.zhiyin.invalid-fixture.cn' }) },
    plugins: [{ name: 'isolated-page-lifecycle', setup(build) {
      build.onResolve({ filter: /^@dcloudio\/uni-app$/u }, () => ({ path: 'lifecycle', namespace: 'fixture' }));
      build.onResolve({ filter: /\.vue$/u }, () => ({ path: 'component', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/u, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'component'
        ? 'export default {};'
        : `export function onLoad(fn) { globalThis.__pageHooks.load.push(fn); }
           export function onShow(fn) { globalThis.__pageHooks.show.push(fn); }
           export function onUnload(fn) { globalThis.__pageHooks.unload.push(fn); }`, loader: 'js' }));
    } }]
  });
  outputs.set(page, output);
} } catch (error) {
  rmSync(temp, { recursive: true, force: true });
  throw error;
}
after(() => rmSync(temp, { recursive: true, force: true }));

type Reply = { statusCode: number; data: unknown };
type State = { items: Array<{ id: string }>; latest?: Array<{ id: string }>; hero?: { id: string }; page?: number; more?: boolean; loading: boolean; paging?: boolean; error: string; pageError?: string };
type Runtime = { state(): State; [key: string]: (...args: any[]) => any };
let hooks: Record<'load' | 'show' | 'unload', Array<(...args: any[]) => void>>;
let calls: Array<{ url: URL; method: string }>;
let handler: (url: URL) => Reply | Promise<Reply>;
let scrolls: number;
beforeEach(() => {
  hooks = { load: [], show: [], unload: [] }; calls = []; scrolls = 0;
  const storage = new Map<string, unknown>();
  (globalThis as any).__pageHooks = hooks;
  handler = () => { throw new Error('UNEXPECTED_REQUEST'); };
  (globalThis as any).uni = {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key), $emit() {}, setNavigationBarColor() {}, setTabBarStyle() {},
    pageScrollTo() { scrolls++; }, navigateTo() {}, switchTab() {},
    request(options: any) {
      const url = new URL(options.url); calls.push({ url, method: options.method });
      Promise.resolve(handler(url)).then((reply) => options.success(reply));
    }
  };
});
function mount(page: keyof typeof exportsByPage): Runtime {
  const output = outputs.get(page)!;
  delete require.cache[output];
  return require(output) as Runtime;
}
function item(id: string) {
  return { id, title: id, atmosphereText: '', durationSeconds: 60, audioUrl: 'https://media.example.test/audio.mp3',
    coverImageUrl: '', visualType: 'image', tags: [], isFeatured: true, isMemberOnly: false };
}
function reply(url: URL, ids: string[], more = false): Reply {
  assert.equal(url.pathname, '/api/music-spaces/browse');
  return { statusCode: 200, data: { items: ids.map(item), page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')), hasMore: more } };
}
async function flush() { for (let index = 0; index < 50; index++) await Promise.resolve(); }

test('actual home script uses at most ten preview items and no personal requests anonymously', async () => {
  handler = (url) => reply(url, url.searchParams.get('sort') === 'latest' ? ['latest'] : ['featured']);
  const home = mount('home'); await flush();
  assert.deepEqual(home.state().items.map((row) => row.id), ['featured']);
  assert.deepEqual(home.state().latest?.map((row) => row.id), ['latest']);
  assert.equal(home.state().loading, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === 'GET' && call.url.pathname === '/api/music-spaces/browse'));
  assert.equal(calls.reduce((total, call) => total + Number(call.url.searchParams.get('pageSize')), 0), 10);
});

test('home category preview stays empty rather than restoring recommendations, and clearing restores the bounded preview', async () => {
  handler = (url) => reply(url, url.searchParams.has('primarySceneId') ? [] : ['home']);
  const home = mount('home'); await flush();
  await home.selectPrimaryScene('study-focus');
  assert.deepEqual(home.state().items, []);
  assert.equal(home.state().hero, undefined);
  assert.equal(calls.at(-1)?.url.searchParams.get('pageSize'), '8');
  home.clearScene();
  assert.deepEqual(home.state().items.map((row) => row.id), ['home']);
  assert.equal(calls.length, 3);
});

test('late homepage bootstrap cannot overwrite a selected category', async () => {
  const delayed: Array<() => void> = [];
  handler = (url) => url.searchParams.has('primarySceneId') ? reply(url, ['selected'])
    : new Promise((resolveReply) => delayed.push(() => resolveReply(reply(url, ['old-home']))));
  const home = mount('home');
  await home.selectPrimaryScene('study-focus');
  delayed.forEach((release) => release()); await flush();
  assert.deepEqual(home.state().items.map((row) => row.id), ['selected']);
  assert.equal(home.state().hero?.id, 'selected');
});

test('actual category handlers replace pages, retain the failed page and retry once after duplicate clicks', async () => {
  let attempts = 0;
  handler = (url) => {
    if (url.searchParams.get('page') === '1') return reply(url, Array.from({ length: 20 }, (_, i) => `first-${i}`), true);
    attempts++;
    return attempts === 1 ? { statusCode: 503, data: { code: 'UNAVAILABLE' } } : reply(url, ['second']);
  };
  const categories = mount('categories'); hooks.show[0](); await flush();
  assert.equal(categories.state().items.length, 20);
  const pending = categories.goToPage(2); categories.goToPage(2);
  await pending;
  assert.equal(attempts, 1);
  assert.equal(categories.state().page, 1);
  assert.equal(categories.state().items[0].id, 'first-0');
  assert.ok(categories.state().pageError);
  await categories.retryPageRequest();
  assert.equal(categories.state().page, 2);
  assert.deepEqual(categories.state().items.map((row) => row.id), ['second']);
  assert.equal(categories.state().pageError, '');
  assert.equal(scrolls, 1);
  const count = calls.length; hooks.show[0](); await flush();
  assert.equal(calls.length, count);
  assert.equal(categories.state().page, 2);
});

test('in-flight old page failure cannot set a new selection error or scroll its page', async () => {
  let release!: () => void;
  handler = (url) => {
    if (url.searchParams.get('page') === '2') return new Promise((resolveReply) => {
      release = () => resolveReply({ statusCode: 503, data: {} });
    });
    return reply(url, Array.from({ length: 20 }, (_, i) => `${url.searchParams.get('primarySceneId')}-${i}`), true);
  };
  const categories = mount('categories'); hooks.show[0](); await flush();
  const old = categories.goToPage(2); await flush();
  categories.selectPrimary('deep-work'); await flush();
  release(); await old;
  assert.equal(categories.state().items[0].id, 'deep-work-0');
  assert.equal(categories.state().page, 1);
  assert.equal(categories.state().pageError, '');
  assert.equal(categories.state().paging, false);
  assert.equal(scrolls, 0);
});

test('search pages are bounded, retain failed pages, and keep the submitted keyword on pagination', async () => {
  let attempts = 0;
  handler = (url) => {
    assert.equal(url.searchParams.get('keyword'), '学习');
    assert.equal(url.searchParams.get('pageSize'), '20');
    if (url.searchParams.get('page') === '1') return reply(url, Array.from({ length: 20 }, (_, i) => `first-${i}`), true);
    return ++attempts === 1 ? { statusCode: 503, data: {} } : reply(url, ['last']);
  };
  const search = mount('search');
  await search.runSearch('学习');
  const pending = search.goToPage(2); search.goToPage(2); await pending;
  assert.equal(attempts, 1);
  assert.equal(search.state().page, 1);
  assert.equal(search.state().items.length, 20);
  assert.ok(search.state().pageError);
  await search.retryPageRequest();
  assert.deepEqual(search.state().items.map((item) => item.id), ['last']);
  assert.equal(search.state().page, 2);
  assert.equal(search.state().pageError, '');
});

test('slow search success and failure cannot overwrite a new search or an empty input', async () => {
  const delayed: Array<() => void> = [];
  handler = (url) => url.searchParams.get('keyword') === 'slow'
    ? new Promise((resolveReply) => delayed.push(() => resolveReply(reply(url, ['old']))))
    : reply(url, ['new']);
  const search = mount('search');
  const old = search.runSearch('slow'); await flush();
  await search.runSearch('new'); delayed.shift()!(); await old;
  assert.deepEqual(search.state().items.map((item) => item.id), ['new']);
  handler = () => new Promise((resolveReply) => delayed.push(() => resolveReply({ statusCode: 503, data: {} })));
  const failure = search.runSearch('slow'); await flush();
  await search.runSearch(''); delayed.shift()!(); await failure;
  assert.deepEqual(search.state().items, []);
  assert.equal(search.state().error, '');
  assert.equal(search.state().loading, false);
});

test('search duplicate submit, unmount, invalid input and empty results do not issue unbounded or stale work', async () => {
  let release!: () => void;
  handler = (url) => new Promise((resolveReply) => { release = () => resolveReply(reply(url, ['old'])); });
  const search = mount('search');
  const pending = search.runSearch('x'); search.runSearch('x'); await flush();
  assert.equal(calls.length, 1);
  hooks.unload[0](); release(); await pending;
  assert.deepEqual(search.state().items, []);
  await search.runSearch('a'.repeat(101));
  assert.equal(calls.length, 1);
  assert.ok(search.state().error);
  handler = (url) => reply(url, []);
  await search.runSearch('missing');
  assert.deepEqual(search.state().items, []);
  assert.equal(search.state().more, false);
  assert.equal(search.state().error, '');
  assert.ok(calls.every((call) => call.method === 'GET' && call.url.pathname === '/api/music-spaces/browse'));
});
