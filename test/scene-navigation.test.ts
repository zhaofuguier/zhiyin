import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { buildSync } from 'esbuild';
import { sceneTaxonomy } from '../src/shared/scene-taxonomy.generated.ts';
import type { MusicSpace } from '../src/types/music-space.ts';

type BrowserRuntime = typeof import('../src/services/scene-browser');

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(root, '.test-scene-navigation-'));
const entry = join(temp, 'entry.ts');
const output = join(temp, 'runtime.cjs');
writeFileSync(entry, `export * from ${JSON.stringify('../src/services/scene-browser.ts')};\n`);
buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const browser = require(output) as BrowserRuntime;
after(() => rmSync(temp, { recursive: true, force: true }));

const storage = new Map<string, unknown>();
(globalThis as Record<string, unknown>).uni = {
  getStorageSync(key: string) { return storage.get(key); },
  setStorageSync(key: string, value: unknown) { storage.set(key, structuredClone(value)); },
  removeStorageSync(key: string) { storage.delete(key); }
};

function space(id: string): MusicSpace {
  return {
    id,
    title: id,
    atmosphereText: 'fixture',
    durationSeconds: 60,
    audioUrl: 'https://media.example.test/audio.mp3',
    coverImageUrl: 'https://media.example.test/cover.jpg',
    visualType: 'image',
    category: 'fixture',
    tags: [],
    isFeatured: false,
    isMemberOnly: false
  };
}

test('approved taxonomy exposes the same ordered 7 primary and 31 secondary entries', () => {
  assert.deepEqual(sceneTaxonomy.primaryScenes.map(({ id, name }) => [id, name]), [
    ['study-focus', '学习专注'], ['deep-work', '工作阅读'], ['sleep-aid', '睡前助眠'],
    ['relax-recovery', '放松休息'], ['late-night', '深夜陪伴'],
    ['nature-ambient', '自然氛围'], ['parent-child-sleep', '亲子睡前']
  ]);
  assert.equal(sceneTaxonomy.primaryScenes.flatMap(({ children }) => children).length, 31);
  assert.deepEqual(sceneTaxonomy.primaryScenes.map(({ order }) => order), [1, 2, 3, 4, 5, 6, 7]);
  for (const primary of sceneTaxonomy.primaryScenes) {
    assert.deepEqual(primary.children.map(({ order }) => order), primary.children.map((_, index) => index + 1));
  }
});

test('scene query uses exact primary and secondary contracts and deduplicates aggregates', async () => {
  const calls: unknown[][] = [];
  const query = new browser.LatestSceneQuery({
    async getPrimary(...args) {
      calls.push(['primary', ...args]);
      return [space('shared'), space('shared'), space('primary-only')];
    },
    async getSecondary(...args) {
      calls.push(['secondary', ...args]);
      return [space('shared')];
    }
  });
  const primary = await query.load({ primarySceneId: 'study-focus', sort: 'hot' });
  assert.equal(primary.state, 'loaded');
  if (primary.state === 'loaded') assert.deepEqual(primary.spaces.map(({ id }) => id), ['shared', 'primary-only']);
  const secondary = await query.load({ primarySceneId: 'study-focus', secondarySceneId: 'silent-study', sort: 'latest' });
  assert.equal(secondary.state, 'loaded');
  assert.deepEqual(calls, [
    ['primary', 'study-focus', 'hot'],
    ['secondary', 'study-focus', 'silent-study', 'latest']
  ]);
  assert.deepEqual(browser.deduplicateMusicSpaces([space('same'), space('same')]).map(({ id }) => id), ['same']);
});

test('paged scene requests are bounded and duplicate clicks share one request', async () => {
  const calls: unknown[] = [];
  let release!: (value: import('../src/types/music-space-page').MusicSpacePage) => void;
  const query = new browser.LatestScenePageQuery(async (input) => {
    calls.push(input);
    return new Promise((resolvePromise) => { release = resolvePromise; });
  });
  const selection = { primarySceneId: 'study-focus' as const, sort: 'hot' as const };
  const first = query.load(selection, 2);
  const duplicate = query.load(selection, 2);
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.deepEqual(calls, [{ ...selection, secondarySceneId: undefined, page: 2, pageSize: 20 }]);
  release({ items: [space('page-two')], page: 2, pageSize: 20, hasMore: false });
  const result = await first;
  assert.equal(result.state, 'loaded');
  if (result.state === 'loaded') assert.equal(result.result.items[0].id, 'page-two');
  assert.throws(() => query.load(selection, 1001), /SCENE_PAGE_INVALID/u);
});

test('slow page success or failure cannot replace a newer category or sort', async () => {
  for (const fails of [false, true]) {
    let release!: () => void;
    const query = new browser.LatestScenePageQuery(async (input) => {
      if (input.primarySceneId === 'study-focus') return new Promise((resolvePromise, reject) => {
        release = () => fails ? reject(new Error('late failure')) : resolvePromise({ items: [space('old')], page: 2, pageSize: 20, hasMore: false });
      });
      return { items: [space('new')], page: 1, pageSize: 20, hasMore: false };
    });
    const old = query.load({ primarySceneId: 'study-focus', sort: 'featured' }, 2);
    await Promise.resolve();
    const latest = await query.load({ primarySceneId: 'deep-work', sort: 'latest' });
    assert.equal(latest.state, 'loaded');
    release();
    assert.equal((await old).state, 'stale');
  }
});

test('page failure is visible and permits explicit retry of that same page', async () => {
  const calls: number[] = [];
  const query = new browser.LatestScenePageQuery(async ({ page }) => {
    calls.push(page);
    if (calls.length === 1) throw new Error('offline');
    return { items: [space('retry')], page, pageSize: 20, hasMore: false };
  });
  const selection = { primarySceneId: 'study-focus' as const, sort: 'featured' as const };
  const failure = await query.load(selection, 3);
  assert.equal(failure.state, 'error');
  if (failure.state === 'error') assert.equal(failure.page, 3);
  assert.equal((await query.load(selection, 3)).state, 'loaded');
  assert.deepEqual(calls, [3, 3]);
});

test('invalidating a queued or in-flight page prevents any new page result', async () => {
  let calls = 0;
  const query = new browser.LatestScenePageQuery(async () => {
    calls++;
    return { items: [], page: 1, pageSize: 20, hasMore: false };
  });
  const queued = query.load({ primarySceneId: 'study-focus', sort: 'featured' });
  query.invalidate();
  assert.equal((await queued).state, 'stale');
  assert.equal(calls, 0);
});

test('normal home and category pages cannot restore full-list fetches or accumulate all pages', () => {
  const pages = resolve(root, 'src', 'pages');
  const home = readFileSync(resolve(pages, 'home/index.vue'), 'utf8');
  const categories = readFileSync(resolve(pages, 'categories/index.vue'), 'utf8');
  assert.doesNotMatch(home, /getAllMusicSpaces|getFeaturedMusicSpaces|searchMusicSpaces|sortMusicSpaces|getMusicSpacesByPrimaryScene|getMusicSpacesBySecondaryScene/u);
  assert.match(home, /getHomeMusicPreview\(\)/u);
  assert.match(home, /pageSize: 8/u);
  assert.match(categories, /new LatestScenePageQuery\(getMusicSpacePage\)/u);
  assert.match(categories, /spaces\.value = outcome\.result\.items/u);
  assert.doesNotMatch(categories, /spaces\.value\.push|spaces\.value\.concat/u);
  assert.match(categories, /上一页/u);
  assert.match(categories, /下一页/u);
  assert.match(categories, /pageError/u);
});

test('slow earlier selection cannot overwrite a later fast selection', async () => {
  let releaseSlow!: (value: MusicSpace[]) => void;
  const slow = new Promise<MusicSpace[]>((resolvePromise) => { releaseSlow = resolvePromise; });
  const query = new browser.LatestSceneQuery({
    getPrimary(primary) {
      return primary === 'study-focus' ? slow : Promise.resolve([space('fast-deep-work')]);
    },
    getSecondary() { return Promise.resolve([]); }
  });
  const first = query.load({ primarySceneId: 'study-focus', sort: 'featured' });
  const second = await query.load({ primarySceneId: 'deep-work', sort: 'featured' });
  assert.equal(second.state, 'loaded');
  if (second.state === 'loaded') assert.equal(second.spaces[0].id, 'fast-deep-work');
  releaseSlow([space('slow-study-focus')]);
  assert.equal((await first).state, 'stale');
});

test('slow sort response cannot overwrite the latest sort for the same category', async () => {
  let releaseFeatured!: (value: MusicSpace[]) => void;
  const featured = new Promise<MusicSpace[]>((resolvePromise) => { releaseFeatured = resolvePromise; });
  const query = new browser.LatestSceneQuery({
    getPrimary(_primary, sort) {
      return sort === 'featured' ? featured : Promise.resolve([space('latest-sort')]);
    },
    getSecondary() { return Promise.resolve([]); }
  });
  const first = query.load({ primarySceneId: 'study-focus', sort: 'featured' });
  const second = await query.load({ primarySceneId: 'study-focus', sort: 'latest' });
  assert.equal(second.state, 'loaded');
  if (second.state === 'loaded') assert.equal(second.spaces[0].id, 'latest-sort');
  releaseFeatured([space('stale-featured-sort')]);
  assert.equal((await first).state, 'stale');
});

test('stored home selection is validated and restored without accepting cross-primary secondary ids', () => {
  storage.clear();
  browser.saveSceneSelection({ primarySceneId: 'sleep-aid', secondarySceneId: 'nature-sleep', sort: 'featured' });
  assert.deepEqual(browser.loadSceneSelection(), {
    primarySceneId: 'sleep-aid', secondarySceneId: 'nature-sleep', sort: 'featured'
  });
  assert.throws(() => browser.requireSceneSelection({
    primarySceneId: 'sleep-aid', secondarySceneId: 'silent-study', sort: 'featured'
  }), /SCENE_SELECTION_INVALID/u);
});

test('legacy student caches do not alter taxonomy selection or recommendation query semantics', async () => {
  storage.clear();
  storage.set('zhiyinMode', '学生');
  storage.set('zhiyin.userProfile', { id: 'legacy-student', mode: 'student', schoolName: '旧学校', studyGoal: '备考' });
  const calls: unknown[][] = [];
  const query = new browser.LatestSceneQuery({
    async getPrimary(...args) { calls.push(args); return [space('study-result')]; },
    async getSecondary() { return []; }
  });
  const result = await query.load({ primarySceneId: 'study-focus', sort: 'featured' });
  assert.equal(result.state, 'loaded');
  assert.deepEqual(calls, [['study-focus', 'featured']]);
  assert.equal(storage.get('zhiyinMode'), '学生');
  assert.deepEqual(storage.get('zhiyin.userProfile'), {
    id: 'legacy-student', mode: 'student', schoolName: '旧学校', studyGoal: '备考'
  });
});

test('home and category pages consume the shared taxonomy without legacy scene-config inference', () => {
  const root = resolve(import.meta.dirname, '..', 'src', 'pages');
  const home = readFileSync(resolve(root, 'home', 'index.vue'), 'utf8');
  const categories = readFileSync(resolve(root, 'categories', 'index.vue'), 'utf8');
  assert.match(home, /sceneTaxonomy\.primaryScenes/u);
  assert.match(categories, /sceneTaxonomy\.primaryScenes/u);
  assert.doesNotMatch(categories, /getScenePageConfigs|getMusicSpacesBySceneConfig/u);
  assert.doesNotMatch(home, /featuredSpaces\.value\[0\] \|\| allFeaturedSpaces/u);
  assert.match(categories, /<text class="empty-title">内容准备中<\/text>/u);
  assert.match(categories, /@click="browseRecommendations">返回推荐/u);
});
