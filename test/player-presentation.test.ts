import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initialPlayerPresentation, updatePlayerPresentation, resolveUploadedVisual } from '../src/services/player-presentation.ts';

test('default uploaded-media presentation preserves the entire frame and exposes controls', () => {
  assert.deepEqual(initialPlayerPresentation(), { immersive: false, panel: 'none', fit: 'contain' });
});
test('manual immersion and reveal only alter presentation without mutating the previous state', () => {
  const original = initialPlayerPresentation();
  const immersed = updatePlayerPresentation(original, { type: 'immerse' });
  assert.equal(immersed.immersive, true);
  assert.equal(original.immersive, false);
  assert.deepEqual(updatePlayerPresentation(immersed, { type: 'reveal' }), original);
});
test('opening any sheet restores controls and keeps a single active panel', () => {
  for (const panel of ['display', 'together', 'details'] as const) {
    const state = updatePlayerPresentation({ immersive: true, panel: 'none', fit: 'cover' }, { type: 'panel', panel });
    assert.deepEqual(state, { immersive: false, panel, fit: 'cover' });
    assert.equal(updatePlayerPresentation(state, { type: 'immerse' }).panel, 'none');
  }
});
test('fit is explicit and content changes reset fit and immersion without persistence', () => {
  const fitted = updatePlayerPresentation(initialPlayerPresentation(), { type: 'fit', fit: 'cover' });
  assert.equal(fitted.fit, 'cover');
  assert.deepEqual(updatePlayerPresentation(fitted, { type: 'reset' }), initialPlayerPresentation());
});
test('no uploaded visual produces an honest empty state with no demo assets', () => {
  assert.deepEqual(resolveUploadedVisual({ videoFailed: false, coverFailed: false }), { kind: 'empty', video: '', cover: '' });
});
test('uploaded image is used verbatim and failed image does not invent a fallback', () => {
  const input = { coverImageUrl: '/api/uploads/file/user.jpg', videoFailed: false, coverFailed: false };
  assert.equal(resolveUploadedVisual(input).cover, input.coverImageUrl);
  assert.equal(resolveUploadedVisual({ ...input, coverFailed: true }).kind, 'empty');
});
test('uploaded video uses its own cover and a failed decorative video can show that same cover', () => {
  const input = { visualType: 'motion', motionVideoUrl: '/api/uploads/file/user.mp4', coverImageUrl: '/api/uploads/file/user.png', videoFailed: false, coverFailed: false };
  assert.equal(resolveUploadedVisual(input).kind, 'video');
  assert.equal(resolveUploadedVisual({ ...input, videoFailed: true }).kind, 'image');
  assert.equal(resolveUploadedVisual({ ...input, videoFailed: true, coverFailed: true }).kind, 'empty');
});
test('presentation does not own playback; video stays mounted when controls and panels change', () => {
  const page = readFileSync(new URL('../src/pages/player/index.vue', import.meta.url), 'utf8');
  const video = page.match(/<video\b[^>]+>/u)?.[0] || '';
  assert.match(video, /v-if="uploadedVisual.kind === 'video'"/u);
  assert.doesNotMatch(video, /v-if="[^"]*(?:immersive|panel)/u);
  assert.match(video, /:muted="visualPlaybackConfig.muted"/u);
  assert.match(video, /:loop="visualPlaybackConfig.loop"/u);
  assert.match(page, /v-if="presentation.immersive"[^>]*[\s\S]*显示控件/u);
  assert.match(page, /class="minimal-controls"[\s\S]*@click="togglePlay"/u);
  const helper = readFileSync(new URL('../src/services/player-presentation.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /(?:uni\.|setInterval|fetch\(|recordPlay|localStorage)/u);
});
