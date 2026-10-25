import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { buildSync } from 'esbuild';

type Reply = ({ statusCode: number; data?: unknown } | { fail: true }) & { delayMs?: number };
type Runtime = {
  api: typeof import('../src/services/api');
  network: typeof import('../src/services/network');
  scenes: typeof import('../src/services/scene-configs');
  user: typeof import('../src/services/user');
  activity: typeof import('../src/services/user-activity');
  contracts: typeof import('../src/services/response-contract');
  states: typeof import('../src/services/request-state');
  media: typeof import('../src/services/media-playback');
  feedback: typeof import('../src/services/feedback');
  personal: typeof import('../src/services/personal-content');
  sessionScope: typeof import('../src/services/session-scope');
  session: typeof import('../src/services/session');
  sceneBrowser: typeof import('../src/services/scene-browser');
};

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(root, '.test-runtime-'));
const storage = new Map<string, unknown>();
const replies: Reply[] = [];
const requestCalls: Array<Record<string, unknown>> = [];
let loginCalls = 0;
const modalCalls: Array<Record<string, unknown>> = [];
const navigationCalls: string[] = [];
let runtime: Runtime;

function queue(...items: Reply[]): void { replies.push(...items); }
function resetFake(): void {
  if (runtime) runtime.session.clearSession();
  storage.clear();
  replies.length = 0;
  requestCalls.length = 0;
  loginCalls = 0;
  modalCalls.length = 0;
  navigationCalls.length = 0;
}
function installUni(): void {
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync(key: string) { return storage.get(key); },
    setStorageSync(key: string, value: unknown) { storage.set(key, structuredClone(value)); },
    removeStorageSync(key: string) { storage.delete(key); },
    $emit() {},
    showToast() {},
    showModal(options: Record<string, unknown>) { modalCalls.push(options); },
    navigateTo(options: { url: string }) { navigationCalls.push(options.url); },
    login(options: { success: (value: { code: string }) => void }) {
      loginCalls += 1;
      options.success({ code: 'single-use-login-code' });
    },
    request(options: {
      url: string;
      method?: string;
      data?: unknown;
      header?: unknown;
      success: (value: { statusCode: number; data: unknown }) => void;
      fail: () => void;
    }) {
      requestCalls.push({ url: options.url, method: options.method, data: options.data, header: options.header });
      const reply = replies.shift();
      if (!reply) throw new Error('UNEXPECTED_UNI_REQUEST');
      const respond = () => {
        if ('fail' in reply) options.fail();
        else options.success({ statusCode: reply.statusCode, data: reply.data });
      };
      if (reply.delayMs) setTimeout(respond, reply.delayMs);
      else respond();
    }
  };
}
function validSpace(id = 'space-1') {
  return {
    id,
    title: '专注空间',
    atmosphereText: '保持安静专注',
    durationSeconds: 180,
    audioUrl: 'https://media.example.test/audio.mp3',
    coverImageUrl: 'https://media.example.test/cover.jpg',
    visualType: 'image',
    tags: ['专注'],
    isFeatured: true,
    isMemberOnly: false,
    primaryScene: '学习',
    playCount: 2,
    favoriteCount: 1,
    completionRate: 0.5
  };
}
function validUser() {
  return { id: 'user-1', mode: 'normal', memberLevel: 'free', growthLevel: 1, growthLevelName: '初遇' };
}
function validOrder() {
  return {
    id: 'order-1',
    userId: 'user-1',
    planLevel: 'plus',
    planName: 'Plus月度',
    amountCents: 1200,
    status: 'pending',
    paymentProvider: 'mock',
    createdAt: '2026-07-16T00:00:00.000Z'
  };
}
function validFeedback(id = 'feedback-11111111-1111-4111-8111-111111111111') {
  return {
    id,
    userId: 'user-1',
    submissionPlatform: 'douyin',
    category: 'feature-suggestion',
    content: '希望增加更稳定的定时关闭能力',
    status: 'replied',
    createdAt: '2026-08-31T10:00:00.000Z',
    updatedAt: '2026-08-31T10:01:00.000Z',
    lastReplyAt: '2026-08-31T10:01:00.000Z',
    replies: [{
      id: 'reply-1', feedbackId: id, content: '已收到，感谢反馈',
      actorType: 'admin', actorIdentifier: 'admin-api', createdAt: '2026-08-31T10:01:00.000Z'
    }]
  };
}
function seedSession(userId = 'user-1', token = 'session-token'): void {
  storage.set('zhiyin.sessionToken', token);
  storage.set('zhiyin.sessionExpiresAt', '2099-01-01T00:00:00.000Z');
  storage.set('zhiyin.sessionPrincipalId', userId);
  storage.set('zhiyin.sessionConsent', {
    privacyVersion: 'privacy-v1', termsVersion: 'terms-v1', minorsVersion: 'minors-v1', ageBand: 'adult'
  });
}
function isContractError(error: unknown, code?: string): boolean {
  return error instanceof Error
    && error.name === 'ApiResponseContractError'
    && (!code || (error as Error & { code?: string }).code === code);
}
async function rejectsContract(action: () => Promise<unknown>, code?: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => isContractError(error, code));
}

before(() => {
  installUni();
  const entry = join(temp, 'entry.ts');
  const service = (name: string) => JSON.stringify('../src/services/' + name);
  writeFileSync(entry, [
    `export * as api from ${service('api.ts')};`,
    `export * as network from ${service('network.ts')};`,
    `export * as scenes from ${service('scene-configs.ts')};`,
    `export * as user from ${service('user.ts')};`,
    `export * as activity from ${service('user-activity.ts')};`,
    `export * as contracts from ${service('response-contract.ts')};`,
    `export * as states from ${service('request-state.ts')};`,
    `export * as media from ${service('media-playback.ts')};`,
    `export * as feedback from ${service('feedback.ts')};`,
    `export * as personal from ${service('personal-content.ts')};`,
    `export * as sessionScope from ${service('session-scope.ts')};`,
    `export * as session from ${service('session.ts')};`,
    `export * as sceneBrowser from ${service('scene-browser.ts')};`
  ].join('\n'));
  const output = join(temp, 'runtime.cjs');
  buildSync({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: {
      'import.meta.env': JSON.stringify({
        VITE_APP_MODE: 'production',
        VITE_API_BASE_URL: 'https://api.zhiyin.invalid-fixture.cn'
      })
    },
    logLevel: 'silent'
  });
  runtime = require(output) as Runtime;
});
beforeEach(resetFake);
after(() => rmSync(temp, { recursive: true, force: true }));

test('music-space services preserve valid non-empty and empty lists', async () => {
  queue({ statusCode: 200, data: [validSpace()] }, { statusCode: 200, data: [] });
  const full = await runtime.api.getAllMusicSpaces();
  assert.equal(full.length, 1);
  assert.equal(full[0].id, 'space-1');
  assert.deepEqual(await runtime.api.getAllMusicSpaces(), []);
});

test('home preview requests only bounded public pages, retaining server order', async () => {
  queue(
    { statusCode: 200, data: { items: [validSpace('featured-z'), validSpace('featured-a')], page: 1, pageSize: 6, hasMore: false } },
    { statusCode: 200, data: { items: [validSpace('latest')], page: 1, pageSize: 4, hasMore: false } }
  );
  const result = await runtime.api.getHomeMusicPreview();
  assert.deepEqual(result.featured.map((item) => item.id), ['featured-z', 'featured-a']);
  assert.deepEqual(result.latest.map((item) => item.id), ['latest']);
  assert.equal(requestCalls.length, 2);
  const urls = requestCalls.map((call) => new URL(String(call.url)));
  assert.ok(urls.every((url) => url.pathname === '/api/music-spaces/browse'));
  assert.deepEqual(urls.map((url) => url.searchParams.get('pageSize')), ['6', '4']);
  assert.deepEqual(urls.map((url) => url.searchParams.get('sort')), ['featured', 'latest']);
  assert.equal(urls[0].searchParams.get('featuredOnly'), 'true');
  assert.equal(loginCalls, 0);
  assert.ok(requestCalls.every((call) => call.method === 'GET'));
});

test('home with no featured content uses one bounded fallback; errors never trigger fallback', async () => {
  queue(
    { statusCode: 200, data: { items: [], page: 1, pageSize: 6, hasMore: false } },
    { statusCode: 200, data: { items: [], page: 1, pageSize: 4, hasMore: false } },
    { statusCode: 200, data: { items: [validSpace('fallback')], page: 1, pageSize: 6, hasMore: false } }
  );
  assert.equal((await runtime.api.getHomeMusicPreview()).featured[0].id, 'fallback');
  assert.equal(requestCalls.length, 3);
  assert.equal(new URL(String(requestCalls[2].url)).searchParams.get('pageSize'), '6');
  resetFake();
  queue({ statusCode: 503, data: { code: 'UNAVAILABLE' } },
    { statusCode: 200, data: { items: [], page: 1, pageSize: 4, hasMore: false } });
  await assert.rejects(() => runtime.api.getHomeMusicPreview());
  assert.equal(requestCalls.length, 2);
});

test('paged response rejects oversized, duplicate, malformed and mismatched pages', async () => {
  const page = { items: [validSpace()], page: 1, pageSize: 1, hasMore: false };
  for (const response of [
    [], { ...page, page: 2 }, { ...page, pageSize: 50 }, { ...page, hasMore: 'true' },
    { ...page, items: [validSpace(), validSpace('other')] },
    { ...page, items: [], hasMore: true }, { ...page, items: [null] }
  ]) {
    queue({ statusCode: 200, data: response });
    await rejectsContract(() => runtime.api.getMusicSpacePage({ pageSize: 1 }));
  }
  queue({ statusCode: 200, data: { ...page, pageSize: 2, items: [validSpace(), validSpace()] } });
  await rejectsContract(() => runtime.api.getMusicSpacePage({ pageSize: 2 }));
  const before = requestCalls.length;
  await assert.rejects(() => runtime.api.getMusicSpacePage({ pageSize: 51 }));
  await assert.rejects(() => runtime.api.getMusicSpacePage({ secondarySceneId: 'light-focus' }));
  assert.equal(requestCalls.length, before);
});

test('bounded scene pages use exact filters and preserve a valid empty page', async () => {
  queue({ statusCode: 200, data: { items: [], page: 3, pageSize: 20, hasMore: false } });
  const result = await runtime.api.getMusicSpacePage({ primarySceneId: 'study-focus', secondarySceneId: 'light-focus', sort: 'hot', page: 3 });
  assert.deepEqual(result.items, []);
  const url = new URL(String(requestCalls[0].url));
  assert.equal(url.searchParams.get('primarySceneId'), 'study-focus');
  assert.equal(url.searchParams.get('secondarySceneId'), 'light-focus');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(result.hasMore, false);
});

test('anonymous scene navigation uses exact public endpoints, deduplicates aggregates and makes zero personal writes', async () => {
  const query = new runtime.sceneBrowser.LatestSceneQuery({
    getPrimary: runtime.api.getMusicSpacesByPrimaryScene,
    getSecondary: runtime.api.getMusicSpacesBySecondaryScene
  });
  queue(
    { statusCode: 200, data: [validSpace('shared'), validSpace('shared')] },
    { statusCode: 200, data: [validSpace('secondary')] }
  );
  const primary = await query.load({ primarySceneId: 'study-focus', sort: 'hot' });
  const secondary = await query.load({
    primarySceneId: 'study-focus', secondarySceneId: 'silent-study', sort: 'featured'
  });
  assert.equal(primary.state, 'loaded');
  if (primary.state === 'loaded') assert.deepEqual(primary.spaces.map(({ id }) => id), ['shared']);
  assert.equal(secondary.state, 'loaded');
  assert.deepEqual(requestCalls.map(({ url }) => url), [
    'https://api.zhiyin.invalid-fixture.cn/api/music-spaces/categories/study-focus?sort=hot',
    'https://api.zhiyin.invalid-fixture.cn/api/music-spaces/categories/study-focus/silent-study?sort=featured'
  ]);
  assert.equal(requestCalls.every(({ method }) => method === 'GET'), true);
  assert.equal(requestCalls.some(({ header }) => 'Authorization' in (header as Record<string, unknown>)), false);
});

test('music-space list rejects object, null and missing required fields', async () => {
  for (const value of [{}, null, [{ ...validSpace(), title: undefined }]]) {
    queue({ statusCode: 200, data: value });
    await rejectsContract(() => runtime.api.getAllMusicSpaces());
  }
});

test('music-space detail distinguishes HTTP 404 from invalid HTTP 200', async () => {
  queue({ statusCode: 404, data: { code: 'NOT_FOUND' } }, { statusCode: 200, data: {} });
  assert.equal(await runtime.api.getMusicSpaceDetail('missing'), undefined);
  await rejectsContract(() => runtime.api.getMusicSpaceDetail('invalid'));
});

test('scene and public business endpoints reject malformed 2xx without demo fallback', async () => {
  queue(
    { statusCode: 200, data: {} },
    { statusCode: 200, data: null },
    { statusCode: 200, data: [{ name: '学校', studentCount: 1, ambassadorCount: 0 }] },
    { statusCode: 200, data: [{ level: 'plus' }] }
  );
  await rejectsContract(() => runtime.scenes.getSceneConfigs());
  await rejectsContract(() => runtime.user.getSchoolOptions());
  await rejectsContract(() => runtime.user.getSchoolSummary('测试大学'));
  await rejectsContract(() => runtime.user.getMembershipPlans());
});

test('invalid user response does not overwrite cached profile', async () => {
  const cached = validUser();
  storage.set('zhiyin.userProfile', cached);
  seedSession();
  queue({ statusCode: 200, data: { id: 'user-1', mode: 'normal' } });
  await rejectsContract(() => runtime.user.refreshCurrentUser(), 'API_RESPONSE_REQUIRED_FIELD_MISSING');
  assert.deepEqual(storage.get('zhiyin.userProfile'), cached);
  assert.equal(runtime.network.requestErrorMessage(
    new runtime.contracts.ApiResponseContractError('API_RESPONSE_CONTRACT_INVALID')
  ), '服务数据异常，请稍后重试');
});

test('entitlements, orders and payment responses enforce their minimum contracts', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: { userId: 'user-1', memberLevel: 'free' } },
    { statusCode: 200, data: { id: 'order-1' } }
  );
  await rejectsContract(() => runtime.user.getUserEntitlements());
  await rejectsContract(() => runtime.user.createMembershipOrder('plus'));
});

test('activity reads reject malformed favorites, history and reactions', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: {} },
    { statusCode: 200, data: null },
    { statusCode: 200, data: [{ label: '同频', count: '1', reacted: true }] }
  );
  await rejectsContract(() => runtime.activity.getFavoriteSpaces());
  await rejectsContract(() => runtime.activity.getPlayHistory());
  await rejectsContract(() => runtime.activity.getReactionSummary('space-1'));
});

test('invalid write responses do not produce local success or mutate local activity', async () => {
  seedSession();
  storage.set('zhiyin.favoriteIds', ['existing']);
  storage.set('zhiyin.playHistory', [{ musicSpaceId: 'existing', currentTime: 1, durationSeconds: 2, playedAt: '2026-01-01T00:00:00.000Z' }]);
  storage.set('zhiyin.reactions', { existing: ['同频'] });
  queue(
    { statusCode: 200, data: {} },
    { statusCode: 200, data: { recorded: true } },
    { statusCode: 200, data: { summary: null } }
  );
  await rejectsContract(() => runtime.activity.toggleFavoriteSpace(validSpace()));
  await rejectsContract(() => runtime.activity.recordPlayEvent(validSpace(), 10));
  await rejectsContract(() => runtime.activity.toggleReaction('space-1', '同频'));
  assert.deepEqual(storage.get('zhiyin.favoriteIds'), ['existing']);
  assert.deepEqual(storage.get('zhiyin.playHistory'), [{ musicSpaceId: 'existing', currentTime: 1, durationSeconds: 2, playedAt: '2026-01-01T00:00:00.000Z' }]);
  assert.deepEqual(storage.get('zhiyin.reactions'), { existing: ['同频'] });
});

test('authenticated request retries one 401 exactly once', async () => {
  seedSession();
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' } },
    { statusCode: 200, data: { token: 'renewed-token', expiresAt: '2099-01-01T00:00:00.000Z', user: validUser() } },
    { statusCode: 200, data: [] }
  );
  assert.deepEqual(await runtime.activity.getFavoriteSpaces(), []);
  assert.equal(loginCalls, 1);
  assert.equal(requestCalls.length, 3);
});

test('verified same-identity renewal preserves playback scope and one initial-count eligibility', async () => {
  seedSession();
  const scope = runtime.sessionScope.captureSessionScope();
  const evidence = new runtime.media.ContentPlaybackEvidence();
  evidence.onAudioPlay();
  const first = evidence.prepareProgress(12);
  assert.deepEqual(first?.submission, { currentTime: 12, completed: false });
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' } },
    { statusCode: 200, data: { token: 'renewed-token', expiresAt: '2099-02-01T00:00:00.000Z', user: validUser() } },
    { statusCode: 200, data: { recorded: false } }
  );
  assert.equal(await runtime.personal.recordPlayEventForSession(scope, validSpace(), 12), 'recorded');
  first?.commit();
  assert.equal(runtime.sessionScope.isSessionScopeCurrent(scope), true);
  assert.equal(storage.get('zhiyin.sessionToken'), 'renewed-token');
  assert.equal(evidence.prepareProgress(12), undefined);

  queue({ statusCode: 200, data: { recorded: false } });
  const later = evidence.prepareProgress(30);
  assert.deepEqual(later?.submission, { currentTime: 30, completed: false });
  assert.equal(await runtime.personal.recordPlayEventForSession(scope, validSpace(), 30), 'recorded');
  later?.commit();
  assert.equal(loginCalls, 1);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/auth/session/login')).length, 1);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/play-events')).length, 3);
});

test('concurrent personal 401 responses share one verified renewal and each retry at most once', async () => {
  seedSession();
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' }, delayMs: 5 },
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' }, delayMs: 5 },
    { statusCode: 200, data: { token: 'shared-renewed-token', expiresAt: '2099-02-01T00:00:00.000Z', user: validUser() }, delayMs: 5 },
    { statusCode: 200, data: [] },
    { statusCode: 200, data: [] }
  );
  const [favorites, history] = await Promise.all([
    runtime.activity.getFavoriteSpaces(),
    runtime.activity.getPlayHistory()
  ]);
  assert.deepEqual(favorites, []);
  assert.deepEqual(history, []);
  assert.equal(loginCalls, 1);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/auth/session/login')).length, 1);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/favorites')).length, 2);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/history')).length, 2);
});

test('logout during renewal prevents stale token commit and old-operation replay', async () => {
  seedSession();
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' } },
    { statusCode: 200, data: { token: 'stale-renewed-token', expiresAt: '2099-02-01T00:00:00.000Z', user: validUser() }, delayMs: 15 }
  );
  const pending = runtime.activity.getFavoriteSpaces();
  runtime.session.clearSession();
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'USER_SESSION_CHANGED');
    return true;
  });
  assert.equal(storage.has('zhiyin.sessionToken'), false);
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/favorites')).length, 1);
});

test('account switch during renewal preserves the new account and never replays the old write', async () => {
  seedSession();
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' } },
    { statusCode: 200, data: { token: 'stale-renewed-token', expiresAt: '2099-02-01T00:00:00.000Z', user: validUser() }, delayMs: 15 }
  );
  const pending = runtime.activity.recordPlayEvent(validSpace(), 12);
  runtime.session.clearSession();
  seedSession('user-2', 'account-b-token');
  storage.set('zhiyin.sessionConsent', {
    privacyVersion: 'privacy-v2', termsVersion: 'terms-v2', minorsVersion: 'minors-v2', ageBand: 'minor-14-17'
  });
  storage.set('zhiyin.userProfile', { ...validUser(), id: 'user-2' });
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'USER_SESSION_CHANGED');
    return true;
  });
  assert.equal(storage.get('zhiyin.sessionToken'), 'account-b-token');
  assert.equal(storage.get('zhiyin.sessionPrincipalId'), 'user-2');
  assert.deepEqual(storage.get('zhiyin.sessionConsent'), {
    privacyVersion: 'privacy-v2', termsVersion: 'terms-v2', minorsVersion: 'minors-v2', ageBand: 'minor-14-17'
  });
  assert.equal((storage.get('zhiyin.userProfile') as { id?: string }).id, 'user-2');
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/play-events')).length, 1);
});

test('same-token renewal is rejected when the server resolves a different identity', async () => {
  seedSession();
  queue(
    { statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' } },
    { statusCode: 200, data: { token: 'wrong-identity-token', expiresAt: '2099-02-01T00:00:00.000Z', user: { ...validUser(), id: 'user-2' } } }
  );
  await assert.rejects(() => runtime.activity.getFavoriteSpaces(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'SESSION_IDENTITY_CHANGED');
    return true;
  });
  assert.equal(storage.get('zhiyin.sessionToken'), 'session-token');
  assert.equal(storage.get('zhiyin.sessionPrincipalId'), 'user-1');
  assert.equal(requestCalls.filter((call) => String(call.url).endsWith('/api/user-activity/favorites')).length, 1);
});

test('old profile response cannot overwrite the cache after account switch', async () => {
  seedSession();
  storage.set('zhiyin.userProfile', validUser());
  queue({ statusCode: 200, data: validUser(), delayMs: 15 });
  const pending = runtime.user.refreshCurrentUser();
  runtime.session.clearSession();
  seedSession('user-2', 'account-b-token');
  const accountB = { ...validUser(), id: 'user-2', nickname: '账号B' };
  storage.set('zhiyin.userProfile', accountB);
  await assert.rejects(pending, /USER_SESSION_CHANGED/u);
  assert.deepEqual(storage.get('zhiyin.userProfile'), accountB);
});

test('502, 503 and WRITE_FROZEN never trigger login retry', async () => {
  for (const reply of [
    { statusCode: 502, data: { code: 'BAD_GATEWAY' } },
    { statusCode: 503, data: { code: 'UPSTREAM_UNAVAILABLE' } },
    { statusCode: 503, data: { code: 'WRITE_FROZEN' } }
  ]) {
    resetFake();
    seedSession();
    queue(reply);
    await assert.rejects(() => runtime.activity.getFavoriteSpaces());
    assert.equal(loginCalls, 0);
    assert.equal(requestCalls.length, 1);
  }
});

test('public requests carry the compile-time platform header without using query identity', async () => {
  queue({ statusCode: 200, data: [] });
  await runtime.api.getAllMusicSpaces();
  assert.deepEqual(requestCalls[0]?.header, { 'X-Zhiyin-Platform': 'douyin' });
  assert.doesNotMatch(String(requestCalls[0]?.url), /[?&]platform=/u);
});

test('next recommendations request two records and reject oversized, duplicate or self results', async () => {
  queue({ statusCode: 200, data: [validSpace()] });
  assert.equal((await runtime.api.getNextMusicSpaces('current')).length, 1);
  const url = new URL(String(requestCalls.at(-1)?.url));
  assert.equal(url.pathname, '/api/music-spaces/current/next');
  assert.equal(url.searchParams.get('limit'), '2');
  for (const items of [
    [validSpace(), { ...validSpace(), id: 'second' }, { ...validSpace(), id: 'third' }],
    [validSpace(), validSpace()], [{ ...validSpace(), id: 'current' }]
  ]) {
    queue({ statusCode: 200, data: items });
    await rejectsContract(() => runtime.api.getNextMusicSpaces('current'));
  }
  queue({ statusCode: 200, data: [] });
  assert.deepEqual(await runtime.api.getNextMusicSpaces('current'), []);
});

test('anonymous public browsing and free playback preparation make zero personal calls', async () => {
  const scene = {
    id: 'study', name: '学习', query: '学习', groupName: '学习', mode: 'both', status: 'enabled', sortOrder: 1,
    defaultSort: 'featured', visibleSorts: ['featured'], matchTags: ['学习'], showOnHome: true, showOnScenePage: true, showOnStudentPage: true
  };
  queue(
    { statusCode: 200, data: [validSpace()] },
    { statusCode: 200, data: [scene] },
    { statusCode: 200, data: [validSpace()] },
    { statusCode: 200, data: validSpace() }
  );

  assert.equal((await runtime.api.getAllMusicSpaces()).length, 1);
  assert.equal((await runtime.scenes.getSceneConfigs()).length, 1);
  assert.equal((await runtime.api.searchMusicSpaces('专注')).length, 1);
  const detail = await runtime.api.getMusicSpaceDetail('space-1');
  assert.equal(detail?.id, 'space-1');
  const recent = await runtime.personal.loadOptionalLastPlayed();
  assert.equal(recent.state, 'anonymous');
  assert.equal(recent.scope.authenticated, false);
  assert.equal(recent.space, undefined);
  const personal = await runtime.personal.loadOptionalPlayerPersonalState(detail!);
  assert.equal(personal.state, 'anonymous');
  assert.equal(personal.lockedByMembership, false);
  assert.equal(await runtime.personal.recordPlayEventForSession(personal.scope, detail!, 12), 'skipped');
  assert.equal(requestCalls.length, 4);
  assert.equal(requestCalls.some((call) => String(call.url).includes('/user-activity/') || String(call.url).includes('/users/me')), false);
  assert.equal(requestCalls.some((call) => 'Authorization' in (call.header as Record<string, unknown>)), false);
});

test('anonymous protected action prompts without a request or automatic navigation', () => {
  assert.equal(runtime.sessionScope.requireSessionForAction('收藏'), false);
  assert.equal(requestCalls.length, 0);
  assert.equal(modalCalls.length, 1);
  assert.equal(modalCalls[0]?.title, '登录后使用');
  assert.equal(navigationCalls.length, 0);
  (modalCalls[0]?.success as ((result: { confirm: boolean }) => void))({ confirm: false });
  assert.equal(navigationCalls.length, 0);
  (modalCalls[0]?.success as ((result: { confirm: boolean }) => void))({ confirm: true });
  assert.deepEqual(navigationCalls, ['/pages/privacy/index']);
});

test('personal endpoint failures do not invalidate a successfully loaded free detail', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: validSpace() },
    { fail: true },
    { fail: true },
    { fail: true }
  );
  const detail = await runtime.api.getMusicSpaceDetail('space-1');
  assert.equal(detail?.id, 'space-1');
  const personal = await runtime.personal.loadOptionalPlayerPersonalState(detail!);
  assert.equal(personal.state, 'unavailable');
  assert.equal(personal.lockedByMembership, false);
  assert.equal(personal.favorite, false);
  assert.equal(requestCalls.length, 4);
});

test('account switch invalidates old personal results and playback writes before dispatch', async () => {
  seedSession();
  const scope = runtime.sessionScope.captureSessionScope();
  storage.set('zhiyin.sessionToken', 'different-session-token');
  queue({ statusCode: 200, data: { recorded: true, history: { musicSpaceId: 'space-1', currentTime: 12, durationSeconds: 180, playedAt: '2026-01-01T00:00:00.000Z' } } });
  assert.equal(await runtime.personal.recordPlayEventForSession(scope, validSpace(), 12), 'stale');
  assert.equal(requestCalls.length, 0);
  assert.equal(replies.length, 1);
});

test('an in-flight personal response is discarded after the bearer account changes', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: { userId: 'user-1', memberLevel: 'free', canPlayMemberOnly: false, canUseMotionPremium: false, canDownload: false }, delayMs: 15 },
    { statusCode: 200, data: { isFavorite: true }, delayMs: 15 },
    { statusCode: 200, data: [{ musicSpaceId: 'space-1', currentTime: 44, durationSeconds: 180, playedAt: '2026-01-01T00:00:00.000Z' }], delayMs: 15 }
  );
  const pending = runtime.personal.loadOptionalPlayerPersonalState(validSpace());
  storage.set('zhiyin.sessionToken', 'account-b-session-token');
  const result = await pending;
  assert.equal(result.state, 'stale');
  assert.equal(result.favorite, false);
  assert.equal(result.history, undefined);
  assert.equal(requestCalls.length, 3);
});

test('a delayed 401 from the previous account cannot renew or clear the new session', async () => {
  seedSession();
  queue({ statusCode: 401, data: { code: 'USER_SESSION_REQUIRED' }, delayMs: 15 });
  const pending = runtime.activity.getFavoriteSpaces();
  storage.set('zhiyin.sessionToken', 'account-b-session-token');
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'USER_SESSION_CHANGED');
    return true;
  });
  assert.equal(loginCalls, 0);
  assert.equal(storage.get('zhiyin.sessionToken'), 'account-b-session-token');
  assert.equal(requestCalls.length, 1);
});

test('empty authenticated history never fabricates a continue-playing card', async () => {
  seedSession();
  queue({ statusCode: 200, data: [] });
  const result = await runtime.personal.loadOptionalLastPlayed();
  assert.equal(result.state, 'loaded');
  assert.equal(result.space, undefined);
  assert.equal(result.history, undefined);
  assert.equal(requestCalls.length, 1);
});

test('primary and secondary scene requests use exact catalog endpoints and preserve classification labels', async () => {
  const classified = {
    ...validSpace('classified-space'),
    contentForm: 'instrumental-music',
    scenePlacements: [
      { primarySceneId: 'study-focus', secondarySceneId: 'light-focus', isPrimary: true, sortWeight: 90, isFeatured: true },
      { primarySceneId: 'late-night', secondarySceneId: 'late-night-music', isPrimary: false, sortWeight: 20, isFeatured: false }
    ]
  };
  queue({ statusCode: 200, data: [classified] }, { statusCode: 200, data: [classified] });

  const primary = await runtime.api.getMusicSpacesByPrimaryScene('study-focus');
  const secondary = await runtime.api.getMusicSpacesBySecondaryScene('study-focus', 'light-focus', 'latest');

  assert.equal(requestCalls[0]?.url, 'https://api.zhiyin.invalid-fixture.cn/api/music-spaces/categories/study-focus?sort=featured');
  assert.equal(requestCalls[1]?.url, 'https://api.zhiyin.invalid-fixture.cn/api/music-spaces/categories/study-focus/light-focus?sort=latest');
  assert.equal(primary[0]?.primarySceneLabel, '轻音专注');
  assert.deepEqual(secondary[0]?.alsoSuitableLabels, ['深夜轻音']);
});

test('invalid formal scene placement never becomes an empty production result', async () => {
  queue({ statusCode: 200, data: [{
    ...validSpace('invalid-classification'),
    contentForm: 'instrumental-music',
    scenePlacements: [
      { primarySceneId: 'study-focus', secondarySceneId: 'silent-study', isPrimary: true, sortWeight: 1, isFeatured: false }
    ]
  }] });

  await rejectsContract(() => runtime.api.getMusicSpacesByPrimaryScene('study-focus'));
  assert.equal(requestCalls.length, 1);
});

test('media failures never qualify as successful playback records', () => {
  assert.equal(runtime.media.canSubmitPlayRecord({ contentLoaded: true, playbackStarted: true, currentTime: 1 }), true);
  assert.equal(runtime.media.canSubmitPlayRecord({ contentLoaded: true, playbackStarted: false, currentTime: 20 }), false);
  assert.equal(runtime.media.canSubmitPlayRecord({ contentLoaded: false, playbackStarted: true, currentTime: 20 }), false);
  assert.equal(runtime.media.canSubmitPlayRecord({ contentLoaded: true, playbackStarted: true, currentTime: 0 }), false);
  assert.match(runtime.media.mediaFailureMessage('not-found'), /不存在/);
  assert.match(runtime.media.mediaFailureMessage('range-invalid'), /暂不可播放/);
  assert.match(runtime.media.mediaFailureMessage('timeout'), /超时/);
  assert.match(runtime.media.mediaFailureMessage('unplayable'), /暂不可用/);
});
test('request state controller distinguishes empty, error, not-found, stale, retrying and recovered', () => {
  const { resolveRequestState } = runtime.states;
  assert.equal(resolveRequestState({ value: [] }), 'empty');
  assert.equal(resolveRequestState({ error: new Error('failed') }), 'error');
  assert.equal(resolveRequestState({ detail: true, value: undefined }), 'not-found');
  assert.equal(resolveRequestState({ error: new Error('failed'), hasCachedData: true }), 'stale');
  assert.equal(resolveRequestState({ retrying: true }), 'retrying');
  assert.equal(resolveRequestState({ recovered: true, value: [validSpace()] }), 'recovered');
});

test('feedback service preserves valid pages and a legitimate empty state', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: { items: [validFeedback()], total: 1, page: 1, pageSize: 20, unreadReplyCount: 1 } },
    { statusCode: 200, data: { items: [], total: 0, page: 1, pageSize: 20, unreadReplyCount: 0 } }
  );
  const full = await runtime.feedback.getMyFeedback();
  assert.equal(full.items.length, 1);
  assert.equal(runtime.feedback.hasUnreadFeedbackReply(full.items[0]), true);
  assert.equal('userId' in full.items[0], false);
  assert.equal('submissionPlatform' in full.items[0], false);
  assert.equal('actorType' in full.items[0].replies[0], false);
  assert.equal('actorIdentifier' in full.items[0].replies[0], false);
  assert.equal('feedbackId' in full.items[0].replies[0], false);
  assert.deepEqual(await runtime.feedback.getMyFeedback(), {
    items: [], total: 0, page: 1, pageSize: 20, unreadReplyCount: 0
  });
});

test('feedback invalid 2xx responses fail without becoming empty or successful', async () => {
  seedSession();
  queue(
    { statusCode: 200, data: [] },
    { statusCode: 200, data: { items: [{}], total: 1, page: 1, pageSize: 20, unreadReplyCount: 0 } },
    { statusCode: 200, data: { id: 'fake-success' } }
  );
  await rejectsContract(() => runtime.feedback.getMyFeedback());
  await rejectsContract(() => runtime.feedback.getMyFeedback());
  await rejectsContract(() => runtime.feedback.submitFeedback('other', '这是一条合法长度的反馈内容'));
  assert.equal(requestCalls.length, 3);
});

test('feedback read failures preserve the existing unread object and expose maintenance', async () => {
  seedSession();
  const current = validFeedback();
  queue({ statusCode: 503, data: { code: 'WRITE_FROZEN' } });
  await assert.rejects(() => runtime.feedback.markFeedbackRepliesRead(current.id), (error: unknown) => {
    assert.equal(runtime.network.requestErrorMessage(error), '系统维护中，请稍后重试');
    return true;
  });
  assert.equal(current.userLastReadAt, undefined);
  assert.equal(runtime.feedback.hasUnreadFeedbackReply(current), true);
  assert.equal(loginCalls, 0);
});
