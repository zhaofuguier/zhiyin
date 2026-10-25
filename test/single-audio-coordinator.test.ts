import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SingleAudioCoordinator,
  type SingleAudioAdapter,
  type SingleAudioDependencies
} from '../src/services/single-audio-coordinator-core.ts';
import type { MusicSpace } from '../src/types/music-space.ts';

test('a guide stops at its end without looping or selecting another content; explicit replay starts at zero', async () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent({ ...space('guide', 25), contentForm: 'guided-audio' });
  fixture.coordinator.play();
  const audio = fixture.audio[0];
  audio.emitPlay();
  audio.emitTime(8);
  fixture.coordinator.submitProgress();
  audio.emitEnded();
  await fixture.coordinator.whenWritesSettled();
  assert.equal(audio.loop, false);
  assert.equal(audio.playCalls, 1);
  assert.equal(fixture.audio.length, 1);
  assert.equal(fixture.coordinator.snapshot().current?.id, 'guide');
  assert.equal(fixture.coordinator.snapshot().currentTime, 25);
  assert.equal(fixture.coordinator.snapshot().isPlaying, false);
  assert.deepEqual(fixture.records.map(recordKey), ['guide:8', 'guide:25:completed']);
  fixture.coordinator.play();
  assert.equal(audio.playCalls, 2);
  assert.equal(audio.seekCalls.at(-1), 0);
  assert.equal(fixture.coordinator.snapshot().currentTime, 0);
  audio.emitPlay();
  audio.emitTime(5);
  fixture.coordinator.pause();
  await fixture.coordinator.whenWritesSettled();
  assert.equal(fixture.records.at(-1)?.currentTime, 5);
});

test('one application audio instance survives page subscriptions and reselecting the same content', () => {
  const fixture = createFixture();
  const playerPage: Array<{ id?: string; time: number; playing: boolean }> = [];
  fixture.coordinator.selectContent(space('one'));
  const detachPlayer = fixture.coordinator.subscribe((state) => playerPage.push({
    id: state.current?.id,
    time: state.currentTime,
    playing: state.isPlaying
  }));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(12);
  detachPlayer();

  const scenePage: Array<{ id?: string; time: number; playing: boolean }> = [];
  const detachScene = fixture.coordinator.subscribe((state) => scenePage.push({
    id: state.current?.id,
    time: state.currentTime,
    playing: state.isPlaying
  }));
  fixture.coordinator.selectContent({ ...space('one'), title: 'same content refreshed' });

  assert.equal(fixture.audio.length, 1);
  assert.equal(fixture.audio[0].srcAssignments, 1);
  assert.deepEqual(scenePage.at(-1), { id: 'one', time: 12, playing: true });
  assert.equal(playerPage.length, 3);
  detachScene();
});

test('destroyed pages receive no callbacks and old content audio callbacks cannot mutate new content', () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent(space('A'));
  const pageStates: string[] = [];
  const detach = fixture.coordinator.subscribe((state) => pageStates.push(`${state.current?.id}:${state.currentTime}`));
  fixture.coordinator.play();
  const oldAudio = fixture.audio[0];
  oldAudio.emitPlay();
  oldAudio.emitTime(7);
  detach();
  const detachedCount = pageStates.length;

  fixture.coordinator.selectContent(space('B'));
  oldAudio.emitTime(99);
  oldAudio.emitEnded();

  assert.equal(pageStates.length, detachedCount);
  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.equal(fixture.coordinator.snapshot().currentTime, 0);
  assert.equal(oldAudio.destroyCalls, 1);
});

test('content switch records the old progress deliberately while later old audio callbacks stay inert', async () => {
  const fixture = createFixture({ authenticated: true });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  const oldAudio = fixture.audio[0];
  oldAudio.emitPlay();
  oldAudio.emitTime(27);
  fixture.coordinator.selectContent(space('B'));
  oldAudio.emitTime(80);
  oldAudio.emitEnded();
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [{ id: 'A', currentTime: 27, completed: false }]);
  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.equal(fixture.coordinator.snapshot().currentTime, 0);
});

test('absolute sleep deadline survives page changes, pauses and ordinary content switches, then stops once', () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.coordinator.setSleepTimer(30);
  const deadline = fixture.coordinator.snapshot().sleepDeadlineAt;
  fixture.audio[0].emitPause();
  fixture.coordinator.selectContent(space('B'));

  assert.equal(fixture.coordinator.snapshot().sleepDeadlineAt, deadline);
  fixture.clock.advance(29_000);
  assert.equal(fixture.coordinator.snapshot().timerRemainingSeconds, 1);
  fixture.coordinator.play();
  fixture.audio[1].emitPlay();
  fixture.clock.advance(1_000);
  const stopCalls = fixture.audio[1].stopCalls;
  fixture.clock.advance(10_000);

  assert.equal(stopCalls, 1);
  assert.equal(fixture.audio[1].stopCalls, 1);
  assert.equal(fixture.audio[1].destroyCalls, 1);
  assert.equal(fixture.coordinator.snapshot().isPlaying, false);
  assert.equal(fixture.coordinator.snapshot().sleepDeadlineAt, null);
  assert.equal(fixture.storedDeadline, null);
});

test('application background and system interruption pause without automatic foreground playback', () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent(space('one'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.coordinator.handleApplicationHide();
  assert.equal(fixture.audio[0].pauseCalls, 1);
  assert.equal(fixture.coordinator.snapshot().isPlaying, false);
  fixture.coordinator.handleApplicationShow();
  assert.equal(fixture.audio[0].playCalls, 1);
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.coordinator.handleSystemInterruption();
  fixture.coordinator.handleApplicationShow();
  assert.equal(fixture.audio[0].pauseCalls, 2);
  assert.equal(fixture.audio[0].playCalls, 2);
  assert.equal(fixture.coordinator.snapshot().isPlaying, false);
});

test('foreground checks an absolute deadline even when background timer callbacks were suspended', () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent(space('one'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.coordinator.setSleepTimer(5);
  fixture.clock.jumpWithoutCallbacks(8_000);
  fixture.coordinator.handleApplicationShow();
  fixture.coordinator.handleApplicationShow();

  assert.equal(fixture.audio[0].stopCalls, 1);
  assert.equal(fixture.audio[0].destroyCalls, 1);
  assert.equal(fixture.coordinator.snapshot().timerRemainingSeconds, 0);
  assert.equal(fixture.coordinator.snapshot().isPlaying, false);
});

test('anonymous playback writes nothing while verified renewal continuity retains one play count eligibility', async () => {
  const anonymous = createFixture({ authenticated: false });
  anonymous.coordinator.selectContent(space('anon'));
  anonymous.coordinator.play();
  anonymous.audio[0].emitPlay();
  anonymous.audio[0].emitTime(9);
  anonymous.audio[0].emitPause();
  await anonymous.coordinator.whenWritesSettled();
  assert.equal(anonymous.records.length, 0);

  const authenticated = createFixture({ authenticated: true });
  authenticated.coordinator.selectContent(space('member'));
  authenticated.coordinator.play();
  authenticated.audio[0].emitPlay();
  authenticated.audio[0].emitTime(8);
  authenticated.audio[0].emitPause();
  await authenticated.coordinator.whenWritesSettled();
  authenticated.sessionCurrent = true;
  authenticated.coordinator.play();
  authenticated.audio[0].emitPlay();
  authenticated.audio[0].emitTime(15);
  authenticated.audio[0].emitPause();
  await authenticated.coordinator.whenWritesSettled();
  authenticated.coordinator.play();
  authenticated.audio[0].emitPlay();
  authenticated.audio[0].emitTime(24);
  authenticated.audio[0].emitPause();
  await authenticated.coordinator.whenWritesSettled();

  assert.deepEqual(authenticated.records.map((item) => item.currentTime), [8, 24]);
  assert.equal(authenticated.records.filter((item) => item.currentTime <= 20).length, 1);
  assert.equal(authenticated.audio.length, 1);
});

test('explicit account switch invalidates old writes and clears playback while initial login preserves anonymous audio', async () => {
  const fixture = createFixture({ authenticated: true });
  fixture.coordinator.selectContent(space('one'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(9);
  fixture.sessionCurrent = false;
  fixture.coordinator.handleSessionInvalidated({ reason: 'explicit-login', hadPrincipal: true });
  await fixture.coordinator.whenWritesSettled();

  assert.equal(fixture.records.length, 0);
  assert.equal(fixture.coordinator.snapshot().current, undefined);
  assert.equal(fixture.audio[0].destroyCalls, 1);

  const initialLogin = createFixture({ authenticated: false });
  initialLogin.coordinator.selectContent(space('anonymous-playing'));
  initialLogin.coordinator.play();
  initialLogin.audio[0].emitPlay();
  initialLogin.audio[0].emitTime(11);
  initialLogin.coordinator.handleSessionInvalidated({ reason: 'explicit-login', hadPrincipal: false });
  assert.equal(initialLogin.coordinator.snapshot().current?.id, 'anonymous-playing');
  assert.equal(initialLogin.coordinator.snapshot().currentTime, 11);
  assert.equal(initialLogin.coordinator.snapshot().isPlaying, true);
});

test('single playback and room playback are mutually exclusive', () => {
  const fixture = createFixture();
  fixture.coordinator.selectContent(space('solo'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.coordinator.setSleepTimer(60);
  fixture.coordinator.stopForExclusivePlayback();

  assert.equal(fixture.coordinator.snapshot().current, undefined);
  assert.equal(fixture.coordinator.snapshot().sleepDeadlineAt, null);
  assert.equal(fixture.audio[0].destroyCalls, 1);
});

test('pending 8 second save is followed by the captured 25 second completion in order', async () => {
  const first = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => ++calls === 1 ? first.promise : 'recorded'
  });
  fixture.coordinator.selectContent(space('complete', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();

  assert.deepEqual(fixture.records, [{ id: 'complete', currentTime: 8, completed: false }]);
  first.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [
    { id: 'complete', currentTime: 8, completed: false },
    { id: 'complete', currentTime: 25, completed: true }
  ]);
  assert.equal(fixture.records.filter((item) => item.currentTime <= 20).length, 1);
});

test('content switch captures the old content final position while its earlier save is pending', async () => {
  const first = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => ++calls === 1 ? first.promise : 'recorded'
  });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(25);
  fixture.coordinator.selectContent(space('B'));

  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.deepEqual(fixture.records, [{ id: 'A', currentTime: 8, completed: false }]);
  first.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [
    { id: 'A', currentTime: 8, completed: false },
    { id: 'A', currentTime: 25, completed: false }
  ]);
  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.equal(fixture.coordinator.snapshot().currentTime, 0);
});

test('sleep expiry and user stop preserve their final evidence behind an in-flight save', async () => {
  for (const ending of ['sleep', 'user-stop'] as const) {
    const first = deferred<'recorded' | 'skipped' | 'stale'>();
    let calls = 0;
    const fixture = createFixture({
      authenticated: true,
      recordPlay: async () => ++calls === 1 ? first.promise : 'recorded'
    });
    fixture.coordinator.selectContent(space(ending));
    fixture.coordinator.play();
    fixture.audio[0].emitPlay();
    fixture.audio[0].emitTime(8);
    fixture.coordinator.submitProgress();
    fixture.audio[0].emitTime(25);
    if (ending === 'sleep') {
      fixture.coordinator.setSleepTimer(1);
      fixture.clock.advance(1_000);
    } else {
      fixture.coordinator.stopUserInitiated();
    }
    first.resolve('recorded');
    await fixture.coordinator.whenWritesSettled();
    assert.deepEqual(fixture.records, [
      { id: ending, currentTime: 8, completed: false },
      { id: ending, currentTime: 25, completed: false }
    ]);
  }
});

test('a delayed failure from A cannot alter B state or block B playback writes', async () => {
  const first = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => {
      calls += 1;
      if (calls === 1) return first.promise;
      return 'recorded';
    }
  });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(25);
  fixture.coordinator.selectContent(space('B'));
  fixture.coordinator.play();
  fixture.audio[1].emitPlay();
  fixture.audio[1].emitTime(12);
  fixture.audio[1].emitPause();
  first.reject(new Error('A failed late'));
  await fixture.coordinator.whenWritesSettled();

  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.equal(fixture.coordinator.snapshot().currentTime, 12);
  assert.equal(fixture.coordinator.snapshot().errorMessage, '');
  assert.deepEqual(fixture.records.map((item) => item.id), ['A', 'B']);
});

test('failed initial evidence, duplicate ended events and account switch do not start completion or duplicate count writes', async () => {
  const first = deferred<'recorded' | 'skipped' | 'stale'>();
  const fixture = createFixture({ authenticated: true, recordPlay: async () => first.promise });
  fixture.coordinator.selectContent(space('A', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();
  fixture.audio[0].emitEnded();
  first.reject(new Error('save failed'));
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [{ id: 'A', currentTime: 8, completed: false }]);
  assert.equal(fixture.coordinator.snapshot().errorMessage, '播放记录保存失败，请稍后重试。');

  fixture.sessionEpoch += 1;
  fixture.coordinator.handleSessionInvalidated({ reason: 'logout', hadPrincipal: true });
  await fixture.coordinator.whenWritesSettled();
  assert.equal(fixture.records.length, 1);
  assert.equal(fixture.coordinator.snapshot().current, undefined);
});

test('newer progress coalesces without replacing a queued completion', async () => {
  const first = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => ++calls === 1 ? first.promise : 'recorded'
  });
  fixture.coordinator.selectContent(space('coalesce', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(15);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();
  fixture.audio[0].emitTime(22);
  fixture.coordinator.submitProgress();
  first.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [
    { id: 'coalesce', currentTime: 8, completed: false },
    { id: 'coalesce', currentTime: 25, completed: true }
  ]);
});

test('duplicate ended events while the completion transport is pending still submit completion once', async () => {
  const completion = deferred<'recorded' | 'skipped' | 'stale'>();
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => record.completed ? completion.promise : 'recorded'
  });
  fixture.coordinator.selectContent(space('ended-once', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  await fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();
  await Promise.resolve();
  assert.equal(fixture.records.filter((item) => item.completed).length, 1);
  fixture.audio[0].emitEnded();
  fixture.audio[0].emitEnded();
  completion.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [
    { id: 'ended-once', currentTime: 8, completed: false },
    { id: 'ended-once', currentTime: 25, completed: true }
  ]);
});

test('account switch during an old write cancels its queued tail and permits only the new account session', async () => {
  const oldRequest = deferred<'recorded' | 'skipped' | 'stale'>();
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => record.id === 'A' ? oldRequest.promise : 'recorded'
  });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(25);
  fixture.coordinator.submitProgress();

  fixture.sessionEpoch += 1;
  fixture.coordinator.handleSessionInvalidated({ reason: 'explicit-login', hadPrincipal: true });
  fixture.coordinator.selectContent(space('B'));
  fixture.coordinator.play();
  fixture.audio[1].emitPlay();
  fixture.audio[1].emitTime(12);
  fixture.audio[1].emitPause();
  oldRequest.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records, [
    { id: 'A', currentTime: 8, completed: false },
    { id: 'B', currentTime: 12, completed: false }
  ]);
  assert.equal(fixture.coordinator.snapshot().current?.id, 'B');
  assert.equal(fixture.coordinator.snapshot().currentTime, 12);
  assert.equal(fixture.coordinator.snapshot().errorMessage, '');
});

test('A to B to A serializes the same persistence target without blocking B playback writes', async () => {
  const oldA = deferred<void>();
  let delayFirstA = true;
  const completionOrder: string[] = [];
  const history = new Map<string, number>();
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => {
      if (record.id === 'A' && delayFirstA) {
        delayFirstA = false;
        await oldA.promise;
      }
      history.set(record.id, record.currentTime);
      completionOrder.push(`${record.id}:${record.currentTime}`);
      return 'recorded';
    }
  });

  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(25);
  fixture.coordinator.selectContent(space('B'));
  fixture.coordinator.play();
  fixture.audio[1].emitPlay();
  fixture.audio[1].emitTime(12);
  fixture.audio[1].emitPause();
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[2].emitPlay();
  fixture.audio[2].emitTime(5);
  fixture.audio[2].emitPause();

  assert.deepEqual(fixture.records.map(recordKey), ['A:8', 'B:12']);
  assert.equal(history.get('B'), 12);
  oldA.resolve();
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records.map(recordKey), ['A:8', 'B:12', 'A:25', 'A:5']);
  assert.deepEqual(completionOrder, ['B:12', 'A:8', 'A:25', 'A:5']);
  assert.equal(history.get('A'), 5);
});

test('old A failure cannot pollute new A or be retried over its newer generation', async () => {
  const oldA = deferred<'recorded' | 'skipped' | 'stale'>();
  let delayFirstA = true;
  const history = new Map<string, number>();
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => {
      if (record.id === 'A' && delayFirstA) {
        delayFirstA = false;
        await oldA.promise;
      }
      history.set(record.id, record.currentTime);
      return 'recorded';
    }
  });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(25);
  fixture.coordinator.selectContent(space('B'));
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[1].emitPlay();
  fixture.audio[1].emitTime(5);
  fixture.audio[1].emitPause();
  oldA.reject(new Error('old A failed'));
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records.map(recordKey), ['A:8', 'A:5']);
  assert.equal(history.get('A'), 5);
  assert.equal(fixture.coordinator.snapshot().errorMessage, '');
  assert.equal(await fixture.coordinator.retryFailedSave(), false);
  assert.equal(fixture.records.length, 2);
});

test('explicit save retry replays the failed head before completion and duplicate clicks share one chain', async () => {
  const firstAttempt = deferred<'recorded' | 'skipped' | 'stale'>();
  const retryAttempt = deferred<'recorded' | 'skipped' | 'stale'>();
  const successful: Array<{ id: string; currentTime: number; completed: boolean }> = [];
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => {
      calls += 1;
      if (calls === 1) return firstAttempt.promise;
      if (calls === 2) {
        const result = await retryAttempt.promise;
        if (result === 'recorded') successful.push(record);
        return result;
      }
      successful.push(record);
      return 'recorded';
    }
  });
  fixture.coordinator.selectContent(space('retry', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();
  firstAttempt.reject(new Error('first save failed'));
  await fixture.coordinator.whenWritesSettled();

  assert.equal(fixture.coordinator.snapshot().saveRetryAvailable, true);
  assert.equal(fixture.coordinator.snapshot().saveRetryInFlight, false);
  const retryOne = fixture.coordinator.retryFailedSave();
  const retryTwo = fixture.coordinator.retryFailedSave();
  assert.strictEqual(retryOne, retryTwo);
  await flushMicrotasks();
  assert.deepEqual(fixture.records.map(recordKey), ['retry:8', 'retry:8']);
  assert.equal(fixture.records.filter((item) => item.completed).length, 0);
  retryAttempt.resolve('recorded');
  assert.equal(await retryOne, true);
  await fixture.coordinator.whenWritesSettled();

  assert.deepEqual(fixture.records.map(recordKey), ['retry:8', 'retry:8', 'retry:25:completed']);
  assert.equal(successful.filter((item) => item.currentTime <= 20).length, 1);
  assert.equal(fixture.coordinator.snapshot().saveRetryAvailable, false);
  assert.equal(fixture.coordinator.snapshot().errorMessage, '');
});

test('logout during explicit save retry cancels the old tail after the in-flight request', async () => {
  const firstAttempt = deferred<'recorded' | 'skipped' | 'stale'>();
  const retryAttempt = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => {
      calls += 1;
      if (calls === 1) return firstAttempt.promise;
      return retryAttempt.promise;
    }
  });
  fixture.coordinator.selectContent(space('logout-retry', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.audio[0].emitEnded();
  firstAttempt.reject(new Error('first save failed'));
  await fixture.coordinator.whenWritesSettled();
  const retry = fixture.coordinator.retryFailedSave();
  await flushMicrotasks();
  fixture.sessionEpoch += 1;
  fixture.coordinator.handleSessionInvalidated({ reason: 'logout', hadPrincipal: true });
  retryAttempt.resolve('recorded');

  assert.equal(await retry, false);
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(fixture.records.map(recordKey), ['logout-retry:8', 'logout-retry:8']);
  assert.equal(fixture.coordinator.snapshot().current, undefined);
  assert.equal(fixture.coordinator.snapshot().saveRetryAvailable, false);
});

test('newer backward seek and a new same-content playback remain authoritative instead of taking a maximum', async () => {
  const forwardSave = deferred<'recorded' | 'skipped' | 'stale'>();
  const history = new Map<string, number>();
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async (record) => {
      if (record.currentTime === 60) await forwardSave.promise;
      history.set(record.id, record.currentTime);
      return 'recorded';
    }
  });
  fixture.coordinator.selectContent(space('seek', 120));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  await fixture.coordinator.submitProgress();
  fixture.audio[0].emitTime(60);
  fixture.coordinator.submitProgress();
  fixture.coordinator.seek(30);
  fixture.coordinator.submitProgress();
  forwardSave.resolve('recorded');
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(fixture.records.map(recordKey), ['seek:8', 'seek:60', 'seek:30']);
  assert.equal(history.get('seek'), 30);

  fixture.audio[0].emitEnded();
  await fixture.coordinator.whenWritesSettled();
  fixture.coordinator.seek(5);
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(5);
  fixture.audio[0].emitPause();
  await fixture.coordinator.whenWritesSettled();
  assert.equal(history.get('seek'), 5);
  assert.equal(fixture.records.at(-1)?.currentTime, 5);
});

test('successful retry publishes cleared save state to page subscribers without another audio event', async () => {
  const retryTransport = deferred<'recorded' | 'skipped' | 'stale'>();
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => {
      if (++calls === 1) throw new Error('save failed');
      return retryTransport.promise;
    }
  });
  const observed: Array<{ error: string; available: boolean; busy: boolean }> = [];
  const detach = fixture.coordinator.subscribe(state => observed.push({
    error: state.errorMessage, available: state.saveRetryAvailable, busy: state.saveRetryInFlight
  }));
  fixture.coordinator.selectContent(space('subscriber'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  await fixture.coordinator.submitProgress();
  assert.deepEqual(observed.at(-1), {
    error: '播放记录保存失败，请稍后重试。', available: true, busy: false
  });
  const retry = fixture.coordinator.retryFailedSave();
  assert.equal(observed.at(-1)?.busy, true);
  retryTransport.resolve('recorded');
  assert.equal(await retry, true);
  assert.deepEqual(observed.at(-1), { error: '', available: false, busy: false });
  detach();
});

for (const failure of ['throw', 'skipped', 'stale'] as const) {
  test(`synthetic initial evidence ${failure} retries the actual 20 second submission before completion`, async () => {
    const retryTransport = deferred<'recorded' | 'skipped' | 'stale'>();
    const successful: Array<{ id: string; currentTime: number; completed: boolean }> = [];
    let calls = 0;
    const fixture = createFixture({
      authenticated: true,
      recordPlay: async record => {
        calls += 1;
        if (calls === 1) {
          if (failure === 'throw') throw new Error('initial save failed');
          return failure;
        }
        if (calls === 2) await retryTransport.promise;
        successful.push(record);
        return 'recorded';
      }
    });
    fixture.coordinator.selectContent(space('synthetic', 25));
    fixture.coordinator.play();
    fixture.audio[0].emitPlay();
    fixture.audio[0].emitEnded();
    await fixture.coordinator.whenWritesSettled();
    assert.deepEqual(fixture.records.map(recordKey), ['synthetic:20']);
    const retry = fixture.coordinator.retryFailedSave();
    assert.strictEqual(fixture.coordinator.retryFailedSave(), retry);
    await flushMicrotasks();
    const duringRetry = fixture.records.map(recordKey);
    retryTransport.resolve('recorded');
    assert.equal(await retry, true);
    assert.deepEqual(duringRetry, ['synthetic:20', 'synthetic:20']);
    assert.deepEqual(fixture.records.map(recordKey), ['synthetic:20', 'synthetic:20', 'synthetic:25:completed']);
    assert.deepEqual(successful.map(recordKey), ['synthetic:20', 'synthetic:25:completed']);
    assert.equal(successful.filter(record => record.currentTime <= 20 && !record.completed).length, 1);
  });
}

test('repeated failure keeps synthetic initial evidence retryable and never advances completion automatically', async () => {
  let calls = 0;
  const fixture = createFixture({
    authenticated: true,
    recordPlay: async () => {
      if (++calls <= 2) throw new Error('save still unavailable');
      return 'recorded';
    }
  });
  const observed: Array<{ available: boolean; busy: boolean }> = [];
  const detach = fixture.coordinator.subscribe(state => observed.push({
    available: state.saveRetryAvailable, busy: state.saveRetryInFlight
  }));
  fixture.coordinator.selectContent(space('retry-again', 25));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitEnded();
  await fixture.coordinator.whenWritesSettled();
  assert.equal(await fixture.coordinator.retryFailedSave(), false);
  assert.deepEqual(fixture.records.map(recordKey), ['retry-again:20', 'retry-again:20']);
  assert.deepEqual(observed.at(-1), { available: true, busy: false });
  assert.equal(await fixture.coordinator.retryFailedSave(), true);
  assert.deepEqual(fixture.records.map(recordKey), [
    'retry-again:20', 'retry-again:20', 'retry-again:20', 'retry-again:25:completed'
  ]);
  assert.deepEqual(observed.at(-1), { available: false, busy: false });
  detach();
});

test('hundreds of successful content switches release settled sessions and generation indexes', async () => {
  const fixture = createFixture();
  for (let index = 0; index < 300; index += 1) {
    fixture.coordinator.selectContent(space(`bounded-${index}`));
    fixture.coordinator.play();
    fixture.audio[index].emitPlay();
    fixture.audio[index].emitTime(8);
    await fixture.coordinator.submitProgress();
  }
  fixture.coordinator.stopUserInitiated();
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(retainedWrites(fixture.coordinator), { sessions: 0, generations: 0, tails: 0 });
});

test('hundreds of failed saves retain only the current retryable session and logout releases it', async () => {
  const fixture = createFixture({ recordPlay: async () => { throw new Error('offline'); } });
  for (let index = 0; index < 300; index += 1) {
    fixture.coordinator.selectContent(space(`offline-${index}`));
    fixture.coordinator.play();
    fixture.audio[index].emitPlay();
    fixture.audio[index].emitTime(8);
    await fixture.coordinator.submitProgress();
  }
  fixture.coordinator.stopUserInitiated();
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(retainedWrites(fixture.coordinator), { sessions: 1, generations: 1, tails: 0 });
  assert.equal(fixture.coordinator.snapshot().saveRetryAvailable, true);
  fixture.sessionEpoch += 1;
  fixture.coordinator.handleSessionInvalidated({ reason: 'logout', hadPrincipal: true });
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(retainedWrites(fixture.coordinator), { sessions: 0, generations: 0, tails: 0 });
});

test('reclamation keeps in-flight old content until settlement but discards its inaccessible failure afterward', async () => {
  const pending = deferred<'recorded' | 'skipped' | 'stale'>();
  const fixture = createFixture({ recordPlay: async () => pending.promise });
  fixture.coordinator.selectContent(space('A'));
  fixture.coordinator.play();
  fixture.audio[0].emitPlay();
  fixture.audio[0].emitTime(8);
  fixture.coordinator.submitProgress();
  fixture.coordinator.selectContent(space('B'));
  assert.deepEqual(retainedWrites(fixture.coordinator), { sessions: 1, generations: 1, tails: 1 });
  pending.reject(new Error('late failure'));
  await fixture.coordinator.whenWritesSettled();
  assert.deepEqual(retainedWrites(fixture.coordinator), { sessions: 0, generations: 0, tails: 0 });
  assert.equal(fixture.coordinator.snapshot().errorMessage, '');
  assert.equal(await fixture.coordinator.retryFailedSave(), false);
});

function retainedWrites(coordinator: SingleAudioCoordinator) {
  const internal = coordinator as unknown as {
    writeSessions: Set<unknown>;
    latestWriteGeneration: Map<string, number>;
    targetWriteTails: Map<string, unknown>;
  };
  return { sessions: internal.writeSessions.size, generations: internal.latestWriteGeneration.size, tails: internal.targetWriteTails.size };
}

class FakeAudio implements SingleAudioAdapter {
  private value = '';
  srcAssignments = 0;
  loop = false;
  obeyMuteSwitch = true;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  stopCalls = 0;
  destroyCalls = 0;
  seekCalls: number[] = [];
  private playListener = () => undefined;
  private pauseListener = () => undefined;
  private stopListener = () => undefined;
  private timeListener = () => undefined;
  private endedListener = () => undefined;
  private errorListener = () => undefined;
  get src() { return this.value; }
  set src(value: string) { this.value = value; this.srcAssignments += 1; }
  play() { this.playCalls += 1; }
  pause() { this.pauseCalls += 1; this.pauseListener(); }
  stop() { this.stopCalls += 1; this.stopListener(); }
  seek(position: number) { this.currentTime = position; this.seekCalls.push(position); }
  destroy() { this.destroyCalls += 1; }
  onPlay(listener: () => void) { this.playListener = listener; }
  onPause(listener: () => void) { this.pauseListener = listener; }
  onStop(listener: () => void) { this.stopListener = listener; }
  onTimeUpdate(listener: () => void) { this.timeListener = listener; }
  onEnded(listener: () => void) { this.endedListener = listener; }
  onError(listener: () => void) { this.errorListener = listener; }
  emitPlay() { this.playListener(); }
  emitPause() { this.pauseListener(); }
  emitTime(value: number) { this.currentTime = value; this.timeListener(); }
  emitEnded() { this.endedListener(); }
  emitError() { this.errorListener(); }
}

class FakeClock {
  now = 1_000_000;
  private nextId = 1;
  private intervals = new Map<number, { callback: () => void; delay: number; next: number }>();
  setInterval(callback: () => void, delay: number) {
    const id = this.nextId++;
    this.intervals.set(id, { callback, delay, next: this.now + delay });
    return id;
  }
  clearInterval(handle: unknown) { this.intervals.delete(Number(handle)); }
  advance(milliseconds: number) {
    const end = this.now + milliseconds;
    while (true) {
      const next = [...this.intervals.entries()].sort((a, b) => a[1].next - b[1].next)[0];
      if (!next || next[1].next > end) break;
      this.now = next[1].next;
      if (!this.intervals.has(next[0])) continue;
      next[1].callback();
      if (this.intervals.has(next[0])) next[1].next += next[1].delay;
    }
    this.now = end;
  }
  jumpWithoutCallbacks(milliseconds: number) { this.now += milliseconds; }
}

function createFixture(options: {
  authenticated?: boolean;
  recordPlay?: (record: { id: string; currentTime: number; completed: boolean }) => Promise<'recorded' | 'skipped' | 'stale'>;
} = {}) {
  const audio: FakeAudio[] = [];
  const records: Array<{ id: string; currentTime: number; completed: boolean }> = [];
  const clock = new FakeClock();
  const fixture = {
    audio,
    records,
    clock,
    storedDeadline: null as number | null,
    sessionCurrent: true,
    sessionEpoch: 1,
    coordinator: undefined as unknown as SingleAudioCoordinator
  };
  const dependencies: SingleAudioDependencies = {
    createAudio: () => { const item = new FakeAudio(); audio.push(item); return item; },
    captureSessionScope: () => ({ authenticated: options.authenticated ?? true, epoch: fixture.sessionEpoch }),
    isSessionScopeCurrent: (scope) => fixture.sessionCurrent && (scope as PlaybackScopeFixture).epoch === fixture.sessionEpoch,
    writeTargetKey: (scope, item) => `${(scope as PlaybackScopeFixture).epoch}:${item.id}`,
    recordPlay: async (_scope, item, currentTime, completed) => {
      if (!fixture.sessionCurrent) return 'stale';
      const record = { id: item.id, currentTime, completed };
      records.push(record);
      if (options.recordPlay) return options.recordPlay(record);
      return 'recorded';
    },
    now: () => clock.now,
    setInterval: (callback, delay) => clock.setInterval(callback, delay),
    clearInterval: (handle) => clock.clearInterval(handle),
    readDeadline: () => fixture.storedDeadline,
    writeDeadline: (value) => { fixture.storedDeadline = value; }
  };
  fixture.coordinator = new SingleAudioCoordinator(dependencies);
  return fixture;
}

interface PlaybackScopeFixture {
  authenticated: boolean;
  epoch: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function recordKey(record: { id: string; currentTime: number; completed: boolean }): string {
  return `${record.id}:${record.currentTime}${record.completed ? ':completed' : ''}`;
}

function space(id: string, durationSeconds = 120): MusicSpace {
  return {
    id,
    title: `Space ${id}`,
    atmosphereText: 'fixture',
    durationSeconds,
    audioUrl: `https://media.fixture.invalid/${id}.mp3`,
    coverImageUrl: `https://media.fixture.invalid/${id}.jpg`,
    visualType: 'image',
    contentForm: 'instrumental-music',
    category: 'fixture',
    tags: ['fixture'],
    isFeatured: false,
    isMemberOnly: false
  };
}
