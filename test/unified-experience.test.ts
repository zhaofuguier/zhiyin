import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { redirectLegacyStudentRoute, UNIFIED_SCENE_ROUTE } from '../src/services/legacy-student-route.ts';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('home and profile expose one experience without student-mode entry or profile writes', () => {
  const home = read('src/pages/home/index.vue');
  const profile = read('src/pages/profile/index.vue');
  assert.doesNotMatch(home, /openStudentMode|student-entry|pages\/student\/index/u);
  assert.doesNotMatch(profile, /toggleMode|mode-option|zhiyinMode|updateLocalUserProfile/u);
  assert.doesNotMatch(profile, /学生资料|学习目标|校园大使|schoolName|studyGoal|普通模式|学生模式/u);
  assert.match(profile, /minorMode/u);
  assert.match(profile, /隐私与账号/u);
});

test('legacy student routes perform only a tab switch to the unified scene page', () => {
  const calls: string[] = [];
  let storageWrites = 0;
  let requests = 0;
  (globalThis as Record<string, unknown>).uni = {
    switchTab({ url }: { url: string }) { calls.push(url); },
    setStorageSync() { storageWrites += 1; },
    request() { requests += 1; }
  };
  redirectLegacyStudentRoute();
  redirectLegacyStudentRoute();
  assert.deepEqual(calls, [UNIFIED_SCENE_ROUTE, UNIFIED_SCENE_ROUTE]);
  assert.equal(storageWrites, 0);
  assert.equal(requests, 0);

  for (const page of ['src/pages/student/index.vue', 'src/pages/student-settings/index.vue']) {
    const source = read(page);
    assert.match(source, /redirectLegacyStudentRoute/u);
    assert.doesNotMatch(source, /services\/(user|api|scene-configs)|updateLocalUserProfile|getCurrentUser/u);
  }
});

test('historical routes remain addressable but are titled as the unified scene', () => {
  const pages = JSON.parse(read('src/pages.json')) as { pages: Array<{ path: string; style: { navigationBarTitleText: string } }> };
  for (const path of ['pages/student/index', 'pages/student-settings/index']) {
    assert.deepEqual(pages.pages.find((page) => page.path === path), {
      path,
      style: { navigationBarTitleText: '统一场景' }
    });
  }
  assert.deepEqual(pages.pages.slice(0, 2).map(({ path }) => path), ['pages/home/index', 'pages/categories/index']);
});

test('learning taxonomy remains complete and independent from the removed mode switch', () => {
  const taxonomy = read('src/shared/scene-taxonomy.generated.ts');
  assert.match(taxonomy, /id: 'study-focus', name: '学习专注', order: 1/u);
  assert.match(taxonomy, /id: 'deep-work', name: '工作阅读', order: 2/u);
  assert.match(taxonomy, /primaryScenes\.length !== 7|primaryScenes: \[/u);
  assert.match(taxonomy, /secondarySceneValues\.length !== 31/u);
});

test('client compatibility types and legacy backend-facing services remain present', () => {
  const user = read('src/services/user.ts');
  const api = read('src/services/api.ts');
  assert.match(user, /schoolName\?: string/u);
  assert.match(user, /studyGoal\?: string/u);
  assert.match(user, /ambassadorStatus\?:/u);
  assert.match(user, /mode: 'normal' \| 'student'/u);
  assert.match(api, /export async function getStudentMusicSpaces/u);
});

