import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { demoMusicSpaces } from '../src/demo/music-spaces.ts';
import { validateScenePlacements } from '../src/shared/scene-taxonomy.generated.ts';
import { hasVisibleContentForm } from '../src/services/content-experience.ts';
import { sceneFormCaption, sceneStockFromSpaces } from '../src/services/visible-catalog.ts';
import type { MusicSpace } from '../src/types/music-space.ts';

const root = resolve(import.meta.dirname, '..');

test('demo spaces that can be shown carry a real content form and scene language', () => {
  const visible = demoMusicSpaces.filter((space) => hasVisibleContentForm(space));
  assert.ok(visible.length >= 4);
  for (const space of visible) {
    assert.equal(validateScenePlacements(space.contentForm, space.scenePlacements).length, 0);
    assert.doesNotMatch(space.subtitle || '', /学生专注|类型待标注/u);
  }
  const hidden = demoMusicSpaces.find((space) => space.id === 'unlabeled-pending');
  assert.ok(hidden);
  assert.equal(hasVisibleContentForm(hidden), false);
  assert.equal(sceneFormCaption(hidden!), '');
  const homework = demoMusicSpaces.find((space) => space.id === 'homework-focus');
  assert.equal(sceneFormCaption(homework!), '学习专注 · 纯音乐');
});

test('empty primary scenes and unlabeled spaces stay out of the entrance stock', () => {
  const stock = sceneStockFromSpaces(demoMusicSpaces);
  assert.deepEqual([...stock.primaryIds].sort(), ['deep-work', 'relax-recovery', 'sleep-aid', 'study-focus']);
  for (const id of ['late-night', 'nature-ambient', 'parent-child-sleep'] as const) {
    assert.equal(stock.primaryIds.has(id), false);
  }
  assert.equal(stock.secondaryKeys.has('study-focus:silent-study'), false);
  assert.equal(stock.secondaryKeys.has('study-focus:light-focus'), true);
  const injected = sceneStockFromSpaces([
    { ...demoMusicSpaces[0], contentForm: undefined, scenePlacements: demoMusicSpaces[0].scenePlacements }
  ]);
  assert.equal(injected.primaryIds.size, 0);
});

test('visible pages do not render the unlabeled placeholder or a student-mode switch', () => {
  const files = [
    'src/pages/home/index.vue',
    'src/pages/categories/index.vue',
    'src/pages/favorites/index.vue',
    'src/pages/search/index.vue',
    'src/pages/player/index.vue',
    'src/pages/profile/index.vue',
    'src/components/SingleAudioBar.vue'
  ];
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8');
    assert.doesNotMatch(source, /类型待标注|学生专注空间|普通模式|学生模式|openStudentMode|toggleMode/u);
  }
});

test('a labeled space dropped from a list cannot re-enter through an empty form', () => {
  const space = { contentForm: undefined } as MusicSpace;
  assert.equal(hasVisibleContentForm(space), false);
  assert.equal(sceneFormCaption(space), '');
});
