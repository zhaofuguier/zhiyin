import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContentPlaybackEvidence,
  SILENT_PLAYBACK_SAVE_ERROR,
  canSubmitPlayRecord,
  playbackEvidenceFromEvent,
  resolvePlayerVisualMode,
  resolveVideoPlaybackConfig,
  submitSilentCompletionEvidence
} from '../src/services/media-playback.ts';
import { MediaPlayerLifecycle } from '../src/services/media-player-lifecycle.ts';
import { calculatePlayProgress } from '../../zhiyin-api/src/modules/user-activity/user-activity.calculations.ts';

test('no loop video uses the cover without an error', () => {
  assert.equal(resolvePlayerVisualMode({ videoFailed: false }), 'cover');
});

test('available loop video is visual-only and falls back to the cover on failure', () => {
  assert.equal(resolvePlayerVisualMode({ motionVideoUrl: 'https://media.invalid/loop.mp4', videoFailed: false }), 'muted-loop-video');
  assert.equal(resolvePlayerVisualMode({ motionVideoUrl: 'https://media.invalid/loop.mp4', videoFailed: true }), 'cover');
});

test('silent companion video config requires a user action and stays muted and looping', () => {
  assert.deepEqual(resolveVideoPlaybackConfig('silent-companion'), {
    autoplay: false, loop: true, muted: true, playsinline: true
  });
  assert.deepEqual(resolveVideoPlaybackConfig('instrumental-music'), {
    autoplay: true, loop: true, muted: true, playsinline: true
  });
});

test('decorative video playback creates no content playback evidence', () => {
  assert.deepEqual(playbackEvidenceFromEvent('video-play', 'decorative-video', true), {
    contentPlaybackStarted: false,
    canRecordPlayback: false
  });
  const evidence = new ContentPlaybackEvidence();
  assert.equal(evidence.onVideoPlay('instrumental-music'), false);
  assert.equal(evidence.takeProgress(10), undefined);
  assert.equal(canSubmitPlayRecord({ contentLoaded: true, playbackStarted: false, currentTime: 10 }), false);
});

test('only a loaded audio stream with elapsed time may write playback records', () => {
  assert.deepEqual(playbackEvidenceFromEvent('audio-play', 'audio'), {
    contentPlaybackStarted: true,
    canRecordPlayback: true
  });
  assert.equal(canSubmitPlayRecord({ contentLoaded: true, playbackStarted: true, currentTime: 10 }), true);
  assert.equal(canSubmitPlayRecord({ contentLoaded: true, playbackStarted: true, currentTime: 0 }), false);
});

test('silent companion requires an explicit user action before video playback can write', () => {
  const evidence = new ContentPlaybackEvidence();
  assert.equal(evidence.onVideoPlay('silent-companion'), false);
  assert.equal(evidence.takeProgress(9), undefined);
  evidence.armSilentVideo(30);
  assert.equal(evidence.onVideoPlay('silent-companion'), true);
  evidence.onSilentVideoTimeUpdate(9, 12);
  assert.deepEqual(evidence.takeProgress(0, false, true), { currentTime: 9, completed: false });
});

test('silent companion progress remains monotonic across multiple video loops', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(30);
  evidence.onVideoPlay('silent-companion');
  assert.equal(evidence.onSilentVideoTimeUpdate(4, 8), 4);
  assert.equal(evidence.onSilentVideoTimeUpdate(8, 8), 8);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 8);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 8);
  assert.equal(evidence.onSilentVideoTimeUpdate(4, 8), 12);
  assert.equal(evidence.onSilentVideoTimeUpdate(8, 8), 16);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 16);
  assert.equal(evidence.onSilentVideoTimeUpdate(3, 8), 19);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 24);
  assert.equal(evidence.silentLogicalCurrentTime, 24);
  assert.equal(evidence.silentPlaybackCompleted, false);
});

test('silent loop boundary is counted once for timeupdate rollback followed by ended', () => {
  const evidence = activeSilentEvidence(40);
  assert.equal(evidence.onSilentVideoTimeUpdate(7, 8), 7);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 8);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 8);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 8);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 8);
});

test('silent loop boundary is counted once for ended followed by timeupdate rollback', () => {
  const evidence = activeSilentEvidence(40);
  assert.equal(evidence.onSilentVideoTimeUpdate(7, 8), 7);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 8);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 8);
  assert.equal(evidence.onSilentVideoLoopBoundary(8), 8);
  assert.equal(evidence.onSilentVideoTimeUpdate(0, 8), 8);
});

test('either single silent loop boundary signal advances exactly one segment', () => {
  const rollbackOnly = activeSilentEvidence(40);
  rollbackOnly.onSilentVideoTimeUpdate(7, 8);
  assert.equal(rollbackOnly.onSilentVideoTimeUpdate(0, 8), 8);

  const endedOnly = activeSilentEvidence(40);
  endedOnly.onSilentVideoTimeUpdate(7, 8);
  assert.equal(endedOnly.onSilentVideoLoopBoundary(8), 8);
});

test('wechat and douyin loop event orders produce identical logical progress', () => {
  const wechat = activeSilentEvidence(40);
  const douyin = activeSilentEvidence(40);
  wechat.onSilentVideoTimeUpdate(7, 8);
  wechat.onSilentVideoTimeUpdate(0, 8);
  wechat.onSilentVideoLoopBoundary(8);
  wechat.onSilentVideoTimeUpdate(4, 8);

  douyin.onSilentVideoTimeUpdate(7, 8);
  douyin.onSilentVideoLoopBoundary(8);
  douyin.onSilentVideoTimeUpdate(0, 8);
  douyin.onSilentVideoTimeUpdate(4, 8);

  assert.equal(wechat.silentLogicalCurrentTime, 12);
  assert.equal(douyin.silentLogicalCurrentTime, 12);
});

test('silent companion pause, resume and page hide preserve one play-count submission per session', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(60);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(5, 10);
  assert.deepEqual(evidence.takeProgress(0), { currentTime: 5, completed: false });
  evidence.pause();
  assert.equal(evidence.takeProgress(0), undefined);
  evidence.syncSilentVideoPosition(0);
  evidence.armSilentVideo(60);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(6, 10);
  assert.equal(evidence.takeProgress(0), undefined);
  evidence.onSilentVideoTimeUpdate(10, 10);
  evidence.onSilentVideoLoopBoundary(10);
  evidence.onSilentVideoTimeUpdate(2, 10);
  evidence.onSilentVideoTimeUpdate(8, 10);
  assert.deepEqual(evidence.takeProgress(0), { currentTime: 23, completed: false });
});

test('video segment ended is only a loop boundary and content completes at logical duration', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(18);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(6, 6);
  evidence.onSilentVideoLoopBoundary(6);
  assert.equal(evidence.silentPlaybackCompleted, false);
  assert.equal(evidence.takeProgress(0, true), undefined);
  evidence.onSilentVideoTimeUpdate(6, 6);
  evidence.onSilentVideoLoopBoundary(6);
  assert.equal(evidence.takeProgress(0, true), undefined);
  evidence.onSilentVideoTimeUpdate(6, 6);
  assert.equal(evidence.silentPlaybackCompleted, true);
  assert.deepEqual(evidence.takeProgress(0, true), { currentTime: 18, completed: true });
  assert.equal(evidence.takeProgress(0, true), undefined);
});

test('two-plus loops produce monotonic history, one play count and completion only at content duration', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(25);
  evidence.onVideoPlay('silent-companion');
  const submissions = [];
  evidence.onSilentVideoTimeUpdate(4, 8);
  submissions.push(evidence.takeProgress(0));
  evidence.onSilentVideoTimeUpdate(8, 8);
  evidence.onSilentVideoLoopBoundary(8);
  evidence.onSilentVideoTimeUpdate(8, 8);
  evidence.onSilentVideoLoopBoundary(8);
  evidence.onSilentVideoTimeUpdate(6, 8);
  submissions.push(evidence.takeProgress(0));
  evidence.onSilentVideoTimeUpdate(8, 8);
  evidence.onSilentVideoLoopBoundary(8);
  evidence.onSilentVideoTimeUpdate(1, 8);
  submissions.push(evidence.takeProgress(0, true));

  assert.deepEqual(submissions, [
    { currentTime: 4, completed: false },
    { currentTime: 22, completed: false },
    { currentTime: 25, completed: true }
  ]);

  let activity = { userId: 'user-1', favoriteIds: [], history: [], reactions: {} } as any;
  let musicSpace = {
    id: 'silent-space', title: 'Silent', coverImageUrl: '/cover.png', durationSeconds: 25,
    playCount: 0, favoriteCount: 0, completionRate: 0
  } as any;
  submissions.forEach((submission, index) => {
    assert.ok(submission);
    const change = calculatePlayProgress(
      activity, musicSpace, submission.currentTime, submission.completed, `2026-09-01T00:00:0${index}.000Z`
    );
    activity = change.activity;
    musicSpace = change.musicSpace;
  });
  assert.equal(activity.history[0].currentTime, 25);
  assert.equal(musicSpace.playCount, 1);
  assert.equal(musicSpace.completionRate, 0.36);
});

test('a new explicit silent companion session may produce one new play-count submission', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(30);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(5, 10);
  assert.deepEqual(evidence.takeProgress(0), { currentTime: 5, completed: false });
  evidence.reset();
  evidence.armSilentVideo(30);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(3, 10);
  assert.deepEqual(evidence.takeProgress(0), { currentTime: 3, completed: false });
});

test('timer throttling until completion emits one count proof before the real completed position', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(25);
  evidence.onVideoPlay('silent-companion');
  evidence.onSilentVideoTimeUpdate(10, 10);
  evidence.onSilentVideoLoopBoundary(10);
  evidence.onSilentVideoTimeUpdate(10, 10);
  evidence.onSilentVideoLoopBoundary(10);
  evidence.onSilentVideoTimeUpdate(5, 10);
  assert.equal(evidence.silentPlaybackCompleted, true);
  assert.equal(evidence.silentNeedsInitialPlayCountEvidence, true);
  assert.deepEqual(evidence.takeProgress(0), { currentTime: 20, completed: false });
  assert.deepEqual(evidence.takeProgress(0, true), { currentTime: 25, completed: true });
  assert.equal(evidence.silentNeedsInitialPlayCountEvidence, false);
});

test('silent completion waits for play-count evidence before starting completion transport', async () => {
  const evidence = completedSilentEvidence(25, 8);
  const first = deferred<void>();
  const second = deferred<void>();
  const calls: Array<{ currentTime: number; completed: boolean }> = [];
  const resultPromise = submitSilentCompletionEvidence(evidence, async (submission) => {
    calls.push(submission);
    if (calls.length === 1) return first.promise;
    return second.promise;
  });

  await Promise.resolve();
  assert.deepEqual(calls, [{ currentTime: 20, completed: false }]);
  first.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [
    { currentTime: 20, completed: false },
    { currentTime: 25, completed: true }
  ]);
  second.resolve();
  assert.deepEqual(await resultPromise, { success: true });
});

test('silent completion keeps completion unsent and recoverable when play-count transport fails', async () => {
  const evidence = completedSilentEvidence(25, 8);
  const calls: Array<{ currentTime: number; completed: boolean }> = [];
  const result = await submitSilentCompletionEvidence(evidence, async (submission) => {
    calls.push(submission);
    throw new Error('controlled transport failure');
  });

  assert.deepEqual(result, {
    success: false,
    failedStage: 'play-count',
    errorMessage: '播放记录保存失败，请稍后重试。'
  });
  assert.deepEqual(calls, [{ currentTime: 20, completed: false }]);
  assert.equal(evidence.silentNeedsInitialPlayCountEvidence, true);
  assert.equal(SILENT_PLAYBACK_SAVE_ERROR, '播放记录保存失败，请稍后重试。');

  const retryCalls: Array<{ currentTime: number; completed: boolean }> = [];
  assert.deepEqual(await submitSilentCompletionEvidence(evidence, async (submission) => {
    retryCalls.push(submission);
  }), { success: true });
  assert.deepEqual(retryCalls, [
    { currentTime: 20, completed: false },
    { currentTime: 25, completed: true }
  ]);
});

test('ordered silent completion produces a stable completed history with one play count', async () => {
  const evidence = completedSilentEvidence(25, 8);
  let activity = { userId: 'user-1', favoriteIds: [], history: [], reactions: {} } as any;
  let musicSpace = {
    id: 'silent-space', title: 'Silent', coverImageUrl: '/cover.png', durationSeconds: 25,
    playCount: 0, favoriteCount: 0, completionRate: 0
  } as any;
  let index = 0;
  const completedFlags: boolean[] = [];

  const result = await submitSilentCompletionEvidence(evidence, async (submission) => {
    completedFlags.push(submission.completed);
    const change = calculatePlayProgress(
      activity, musicSpace, submission.currentTime, submission.completed, `2026-09-01T00:00:0${index}.000Z`
    );
    index += 1;
    activity = change.activity;
    musicSpace = change.musicSpace;
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(completedFlags, [false, true]);
  assert.equal(activity.history[0].currentTime, 25);
  assert.equal(musicSpace.playCount, 1);
  assert.equal(musicSpace.completionRate, 0.33);
});

test('silent companion media failure never writes playback progress', () => {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo();
  evidence.fail('silent-content-video');
  assert.equal(evidence.onVideoPlay('silent-companion'), false);
  assert.equal(evidence.takeProgress(8), undefined);
});

test('onHide destroys audio, resets video and timers, while repeated unload is idempotent', () => {
  const calls = { create: 0, stop: 0, destroy: 0, pauseVideo: 0, seekVideo: [] as number[], record: 0, progress: 0, sleep: 0 };
  const lifecycle = new MediaPlayerLifecycle<{ stop(): void; destroy(): void }>();
  lifecycle.getOrCreateAudio(() => {
    calls.create += 1;
    return { stop: () => { calls.stop += 1; }, destroy: () => { calls.destroy += 1; } };
  });
  const hooks = {
    recordProgress: () => { calls.record += 1; },
    clearProgressTimer: () => { calls.progress += 1; },
    clearSleepTimer: () => { calls.sleep += 1; },
    videoContext: () => ({
      pause: () => { calls.pauseVideo += 1; },
      seek: (position: number) => calls.seekVideo.push(position)
    })
  };

  assert.equal(lifecycle.suspend(hooks), true);
  assert.equal(lifecycle.audio, undefined);
  assert.deepEqual(calls, {
    create: 1, stop: 1, destroy: 1, pauseVideo: 1, seekVideo: [0], record: 1, progress: 1, sleep: 1
  });
  assert.equal(lifecycle.suspend(hooks), false);
  assert.equal(calls.destroy, 1);
  assert.equal(calls.pauseVideo, 1);
});

test('foreground does not auto-create audio and the next user action creates exactly one context', () => {
  let created = 0;
  let destroyed = 0;
  const lifecycle = new MediaPlayerLifecycle<{ stop(): void; destroy(): void }>();
  const create = () => {
    created += 1;
    return { stop() {}, destroy: () => { destroyed += 1; } };
  };
  const hooks = {
    recordProgress() {}, clearProgressTimer() {}, clearSleepTimer() {}, videoContext: () => undefined
  };

  lifecycle.getOrCreateAudio(create);
  lifecycle.suspend(hooks);
  lifecycle.enterForeground();
  assert.equal(created, 1);
  const resumed = lifecycle.getOrCreateAudio(create);
  assert.equal(created, 2);
  assert.equal(lifecycle.getOrCreateAudio(create), resumed);
  assert.equal(created, 2);
  lifecycle.suspend(hooks);
  assert.equal(destroyed, 2);
});

function activeSilentEvidence(contentDuration: number): ContentPlaybackEvidence {
  const evidence = new ContentPlaybackEvidence();
  evidence.armSilentVideo(contentDuration);
  assert.equal(evidence.onVideoPlay('silent-companion'), true);
  return evidence;
}

function completedSilentEvidence(contentDuration: number, segmentDuration: number): ContentPlaybackEvidence {
  const evidence = activeSilentEvidence(contentDuration);
  while (!evidence.silentPlaybackCompleted) {
    const remaining = contentDuration - evidence.silentLogicalCurrentTime;
    const position = Math.min(segmentDuration, remaining);
    evidence.onSilentVideoTimeUpdate(position, segmentDuration);
    if (!evidence.silentPlaybackCompleted) {
      evidence.onSilentVideoLoopBoundary(segmentDuration);
      evidence.onSilentVideoTimeUpdate(0, segmentDuration);
    }
  }
  return evidence;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
