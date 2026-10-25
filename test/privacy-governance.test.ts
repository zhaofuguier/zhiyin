import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { buildSync } from 'esbuild';

type Reply = { statusCode: number; data?: unknown };
type Runtime = {
  privacy: typeof import('../src/services/privacy');
  session: typeof import('../src/services/session');
};
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(root, '.test-privacy-'));
const storage = new Map<string, unknown>();
const replies: Reply[] = [];
const requests: Array<Record<string, unknown>> = [];
const events: string[] = [];
let loginCalls = 0;
let runtime: Runtime;

function queue(...values: Reply[]) { replies.push(...values); }
function reset() { storage.clear(); replies.length = 0; requests.length = 0; events.length = 0; loginCalls = 0; }
function seedSession() {
  storage.set('zhiyin.sessionToken', 'existing-session-token');
  storage.set('zhiyin.sessionExpiresAt', '2099-01-01T00:00:00.000Z');
  storage.set('zhiyin.sessionPrincipalId', 'user-1');
  storage.set('zhiyin.sessionConsent', {
    privacyVersion: 'privacy-v1', termsVersion: 'terms-v1', minorsVersion: 'minors-v1', ageBand: 'adult'
  });
}
function validUser() { return { id: 'user-1', mode: 'normal', memberLevel: 'free', growthLevel: 1, ageBand: 'adult', minorMode: false }; }

before(() => {
  (globalThis as Record<string, unknown>).uni = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
    $emit: (event: string) => events.push(event),
    showToast() {},
    login(options: { success: (value: { code: string }) => void }) { loginCalls += 1; options.success({ code: 'one-time-code' }); },
    request(options: { url: string; method?: string; data?: unknown; header?: unknown; success: (value: Reply) => void }) {
      requests.push({ url: options.url, method: options.method, data: options.data, header: options.header });
      const reply = replies.shift(); if (!reply) throw new Error('UNEXPECTED_REQUEST'); options.success(reply);
    }
  };
  const entry = join(temp, 'entry.ts');
  writeFileSync(entry, [
    `export * as privacy from ${JSON.stringify('../src/services/privacy.ts')};`,
    `export * as session from ${JSON.stringify('../src/services/session.ts')};`
  ].join('\n'));
  const output = join(temp, 'runtime.cjs');
  buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { 'import.meta.env': JSON.stringify({ VITE_APP_MODE: 'production', VITE_API_BASE_URL: 'https://api.zhiyin.invalid-fixture.cn' }) }, logLevel: 'silent' });
  runtime = require(output) as Runtime;
});
beforeEach(reset);
after(() => rmSync(temp, { recursive: true, force: true }));

test('login requires explicit unchecked consent fields before platform exchange', async () => {
  await assert.rejects(runtime.privacy.loginWithConsent({ accepted: false }), /USER_CONSENT_REQUIRED/u);
  assert.equal(loginCalls, 0); assert.equal(requests.length, 0); assert.equal(storage.size, 0);
});

test('public legal catalog exposes all three documents and fetches body only from detail', async () => {
  const common = { version: 'v1', title: '技术草案', effectiveDate: '2026-08-30', status: 'draft' };
  queue({ statusCode: 200, data: [
    { id: 'privacy-policy', ...common }, { id: 'terms-of-service', ...common }, { id: 'minors-protection', ...common }
  ] });
  const documents = await runtime.privacy.getLegalDocuments();
  assert.deepEqual(documents.map((item) => item.documentType), ['privacy', 'terms', 'minors']);
  assert.equal(documents.every((item) => item.body === undefined), true);
  queue({ statusCode: 200, data: { id: 'minors-protection', ...common, body: '未成年人保护技术草案正文' } });
  assert.equal((await runtime.privacy.getLegalDocument('minors')).body, '未成年人保护技术草案正文');
  assert.match(String(requests.at(-1)?.url), /\/api\/legal\/documents\/minors-protection$/u);
});

test('under-14 selection never exchanges platform code or creates a local session', async () => {
  await assert.rejects(runtime.privacy.loginWithConsent({
    accepted: true, ageBand: 'under-14', privacyVersion: 'privacy-v1', termsVersion: 'terms-v1',
    minorsVersion: 'minors-v1'
  }), (error: unknown) => error instanceof Error && error.message === 'UNDER_14_ACCOUNT_NOT_AVAILABLE');
  assert.equal(loginCalls, 0); assert.equal(requests.length, 0); assert.equal(storage.has('zhiyin.sessionToken'), false);
});

test('adult and minor login submit consent versions and age band with one platform code', async () => {
  for (const ageBand of ['adult', 'minor-14-17'] as const) {
    reset(); queue({ statusCode: 200, data: { token: `${ageBand}-token`, expiresAt: '2099-01-01T00:00:00.000Z', user: validUser() } });
    await runtime.privacy.loginWithConsent({
      accepted: true, ageBand, privacyVersion: 'privacy-v1', termsVersion: 'terms-v1', minorsVersion: 'minors-v1'
    });
    assert.equal(loginCalls, 1);
    assert.deepEqual(requests[0]?.data, {
      provider: 'douyin', loginCode: 'one-time-code', consent: true,
      privacyVersion: 'privacy-v1', termsVersion: 'terms-v1', minorsVersion: 'minors-v1', ageBand
    });
  }
});

test('personal export accepts provider names but rejects token and platform identity fields', async () => {
  seedSession();
  const safe = { generatedAt: '2026-08-30T00:00:00.000Z', requestId: 'request-1', profile: { id: 'user-1', identityProviders: ['wechat'] }, activity: { favoriteIds: [], history: [], reactions: {} }, orders: [], legalAcceptances: [] };
  queue({ statusCode: 200, data: safe });
  assert.deepEqual(await runtime.privacy.exportPersonalData(), safe);
  queue({ statusCode: 200, data: { ...safe, profile: { id: 'user-1', tokenHash: 'forbidden' } } });
  await assert.rejects(runtime.privacy.exportPersonalData(), /PERSONAL_DATA_EXPORT_RESPONSE_INVALID/u);
});

test('failed deletion preserves bearer, profile, activity and playback caches', async () => {
  seedSession(); storage.set('zhiyin.userProfile', validUser()); storage.set('zhiyin.favoriteIds', ['space-1']); storage.set('currentMusicSpaceId', 'space-1');
  queue({ statusCode: 403, data: { code: 'ACCOUNT_DELETION_IDENTITY_MISMATCH' } });
  await assert.rejects(runtime.privacy.deleteCurrentAccount('注销知音账号'));
  assert.equal(storage.get('zhiyin.sessionToken'), 'existing-session-token');
  assert.deepEqual(storage.get('zhiyin.favoriteIds'), ['space-1']);
  assert.equal(storage.get('currentMusicSpaceId'), 'space-1');
  assert.equal(events.includes('zhiyin:account-deleted'), false);
});

test('successful deletion clears bearer, user, activity and playback state exactly after server success', async () => {
  seedSession(); storage.set('zhiyin.userProfile', validUser()); storage.set('zhiyin.favoriteIds', ['space-1']);
  storage.set('zhiyin.playHistory', [{ musicSpaceId: 'space-1' }]); storage.set('zhiyin.reactions', { 'space-1': ['同频'] });
  storage.set('currentMusicSpaceId', 'space-1'); storage.set('zhiyinTimer', '30 分钟');
  queue({ statusCode: 200, data: { deleted: true, requestId: 'request-1' } });
  assert.deepEqual(await runtime.privacy.deleteCurrentAccount('注销知音账号'), { deleted: true, requestId: 'request-1' });
  for (const key of ['zhiyin.sessionToken', 'zhiyin.sessionExpiresAt', 'zhiyin.sessionConsent', 'zhiyin.sessionPrincipalId', 'zhiyin.userProfile', 'zhiyin.favoriteIds', 'zhiyin.playHistory', 'zhiyin.reactions', 'currentMusicSpaceId', 'zhiyinTimer']) {
    assert.equal(storage.has(key), false, key);
  }
  assert.equal(events.filter((event) => event === 'zhiyin:account-deleted').length, 1);
  assert.deepEqual(requests[0]?.data, { confirmation: '注销知音账号', loginCode: 'one-time-code' });
});
