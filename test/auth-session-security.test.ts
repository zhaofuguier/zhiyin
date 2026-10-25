import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('platform login code is exchanged only through the session endpoint', () => {
  const session = read('src/services/session.ts');
  const user = read('src/services/user.ts');
  assert.match(session, /uni\.login\(/u);
  assert.match(session, /\/api\/auth\/session\/login/u);
  assert.match(session, /provider: platform[\s\S]*loginCode[\s\S]*consent: consent\.consent[\s\S]*privacyVersion/u);
  assert.doesNotMatch(user, /providerUserId|users\/resolve|\$\{provider\}-\$\{loginCode\}/u);
  assert.doesNotMatch(session, /setStorageSync\([^\n]*loginCode/u);
  assert.match(session, /SESSION_LOGIN_RETRY_MESSAGE/u);
  assert.match(session, /loginRetryError\(\)/u);
  assert.match(session, /SESSION_LOGIN_UNAVAILABLE_MESSAGE/u);
  assert.doesNotMatch(session, /session_key|openid|unionid|APP_SECRET|AppSecret/u);
});

test('platform login distinguishes retryable authentication from upstream unavailability', () => {
  const session = read('src/services/session.ts');
  const exchangeBlock = /async function exchangeLoginCode[\s\S]*?\n\}\n\nfunction storedSessionConsent/u.exec(session)?.[0] || '';
  assert.match(exchangeBlock, /statusCode === 401[\s\S]*reject\(loginRetryError\(\)\)/u);
  assert.match(exchangeBlock, /statusCode === 503[\s\S]*reject\(loginUnavailableError\(\)\)/u);
  assert.equal((session.match(/uni\.login\(/gu) || []).length, 1);
  assert.doesNotMatch(exchangeBlock, /uni\.login\(|renewSession|establishSession/u);
});
test('authenticated requests carry Bearer token and retry authentication only once after 401', () => {
  const network = read('src/services/network.ts');
  assert.match(network, /Authorization: `Bearer \$\{token\}`/u);
  assert.equal((network.match(/await recoverSessionAfterUnauthorized\(requestToken\)/gu) || []).length, 1);
  assert.match(network, /error\.statusCode !== 401/u);
});

test('write freeze shows maintenance state and never fabricates login or logout success', () => {
  const session = read('src/services/session.ts');
  const network = read('src/services/network.ts');
  const logoutBlock = /export async function logoutSession[\s\S]*?export async function renewSession/u.exec(session)?.[0] || '';
  assert.match(session, /statusCode === 503 && errorCode\(result\.data\) === 'WRITE_FROZEN'/u);
  assert.match(session, /系统维护中，请稍后重试/u);
  assert.match(network, /markFallback\(SESSION_MAINTENANCE_MESSAGE\)/u);
  assert.equal((logoutBlock.match(/clearSession\(\)/gu) || []).length, 1);
  assert.match(logoutBlock, /statusCode >= 200[\s\S]*clearSession\(\)[\s\S]*resolve\(\)/u);
  assert.match(logoutBlock, /WRITE_FROZEN[\s\S]*reject\(maintenanceError\(\)\)/u);
  assert.doesNotMatch(logoutBlock, /WRITE_FROZEN[\s\S]*clearSession\(\)/u);
});
test('protected activity and order requests never send a client userId', () => {
  const activity = read('src/services/user-activity.ts');
  const user = read('src/services/user.ts');
  assert.doesNotMatch(activity, /userId|\?userId=/u);
  assert.doesNotMatch(user, /data: \{ userId[^}]*planLevel/u);
  assert.match(user, /data: \{ planLevel \}/u);
  assert.match(user, /\/api\/users\/me\/profile/u);
  assert.match(user, /\/api\/users\/me\/entitlements/u);
});

test('configured remote writes do not fall back to optimistic local success', () => {
  const activity = read('src/services/user-activity.ts');
  const user = read('src/services/user.ts');
  assert.match(activity, /if \(API_BASE_URL\) \{[\s\S]*requestAuthenticatedJson/u);
  assert.doesNotMatch(user, /remote \|\| optimistic|remote \|\| \{ \.\.\.current, memberLevel \}/u);
  assert.doesNotMatch(activity, /if \(remote\)[\s\S]*uni\.setStorageSync/u);
});

test('self profile payload excludes server-owned membership, growth and ambassador approval fields', () => {
  const user = read('src/services/user.ts');
  const studentSettings = read('src/pages/student-settings/index.vue');
  const editableBlock = /export type EditableUserProfile = Pick<UserProfile,([\s\S]*?)>;/u.exec(user)?.[1] || '';
  assert.doesNotMatch(editableBlock, /memberLevel|growthLevel|ambassadorTitle|identities|internalKind/u);
  assert.doesNotMatch(studentSettings, /ambassadorTitle:\s*['"]/u);
});
