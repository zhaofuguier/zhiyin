import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { contentExperience, contentPlayLabel } from '../src/services/content-experience.ts';

test('five confirmed forms expose distinct honest labels without guessing from titles', () => {
  const cases = [['silent-companion', '无声画面'], ['instrumental-music', '纯音乐'], ['nature-sound', '自然声音'], ['steady-noise', '稳定噪声'], ['guided-audio', '引导音频']];
  for (const [form, label] of cases) assert.equal(contentExperience(form).label, label);
  for (const form of [undefined, '', 'unknown']) {
    assert.equal(contentExperience(form).label, '类型待标注');
    assert.equal(contentExperience(form).guided, false);
  }
});

test('silent and guided controls distinguish starting, continuing, pausing and completed guides', () => {
  assert.equal(contentPlayLabel('silent-companion', false, 0, 60), '开始陪伴');
  assert.equal(contentPlayLabel('silent-companion', false, 12, 60), '继续陪伴');
  assert.equal(contentPlayLabel('guided-audio', false, 0, 60), '开始引导');
  assert.equal(contentPlayLabel('guided-audio', false, 12, 60), '继续引导');
  assert.equal(contentPlayLabel('guided-audio', false, 60, 60), '重新开始');
  assert.equal(contentPlayLabel('guided-audio', true, 12, 60), '暂停');
  assert.equal(contentPlayLabel(undefined, false, 0, 60), '播放');
});

test('only music uses next-song wording and no form invents language, lyrics or background guarantees', () => {
  assert.equal(contentExperience('instrumental-music').nextLabel, '下一首');
  for (const form of ['nature-sound', 'steady-noise', 'silent-companion', 'guided-audio']) {
    assert.equal(contentExperience(form).nextLabel, '换个环境');
    assert.doesNotMatch(JSON.stringify(contentExperience(form)), /中文|无人声|锁屏|后台连续/u);
  }
});

test('cards, player and cross-page bar share the same content semantics', () => {
  for (const path of ['pages/home/index.vue', 'pages/categories/index.vue', 'pages/favorites/index.vue', 'pages/search/index.vue', 'pages/player/index.vue', 'components/SingleAudioBar.vue']) {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    assert.match(source, /services\/content-experience/u);
  }
  const player = readFileSync(new URL('../src/pages/player/index.vue', import.meta.url), 'utf8');
  assert.match(player, /:aria-label="playLabel"/u);
  assert.match(player, /v-if="guidedCompleted"/u);
  assert.match(player, /!nextSpaces.length/u);
});
